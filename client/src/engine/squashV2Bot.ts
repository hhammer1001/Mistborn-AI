/**
 * SquashV2Bot — going-FIRST specialist. Same scoring methodology as SquashBot
 * + ZoomBot, but trained on a corpus of seat-0-only data and tuned for the
 * tempo-advantage seat. Levers (anti-correlation, atium banking, opp-lead
 * awareness, mission-reward synergy, etc.) are exposed via SquashV2Config in
 * squashBotEval.ts so each can be ablated independently.
 *
 * Bot-class statics control the runtime layers (lookahead, lethal solver) and
 * mirror ZoomBot's design directly — copy of the architecture, gated on
 * turnOrder === 0 instead of === 1.
 */

import type { Game } from "./game";
import type { Player } from "./player";
import type { PlayerDeck } from "./deck";
import { SquashBot } from "./squashBot";
import { type BotProfile } from "./squashBotEval";
import type { GameActionInternal } from "./types";
import { snapshotGame, restoreGame } from "./gameSnapshot";

export class SquashV2Bot extends SquashBot {
  /** Enable 1-ply heuristic-chain lookahead in seat 0. Same architecture as
   * ZoomBot's seat-2 lookahead. ABLATION TARGET. */
  static lookaheadEnabled = true;

  /** Lethal solver triggers when opp HP ≤ this. ABLATION TARGET. */
  static lethalThreshold = 14;

  /** Top-K candidates from heuristic scoring to apply lookahead to. Zoom won
   * with K=2; going first may favor a different value — sweep this. */
  static lookaheadTopK = 2;

  /** Discount on follow-up heuristic value vs immediate. Zoom uses 0.6. */
  static followupWeight = 0.6;

  /** Lookahead depth. 1 = 1-ply chain (default). 2 = 2-ply (recursive on
   * each top followup of each candidate). 2-ply costs ~K^2 simulations per
   * decision. Zoom tested 2-ply, got slight regression — but with V2's
   * different data distribution may be different. */
  static lookaheadDepth = 1;

  // Per-turn lethal-cache: if we already searched and found no lethal at this
  // turn + curDamage, don't re-search until curDamage increases. Without this,
  // late-game turns trigger findLethalAction on every selectAction call (one
  // per intermediate action), each running 12-step greedy lookahead — that
  // compounded into multi-minute turns when the bot can't finish off the opp.
  private lethalSearchedTurn = -1;
  private lethalSearchedCurDamage = -1;
  /** Per-turn invocation cap. Lethal solver chains can return non-damaging
   * first actions (use_boxing, burn_card) that get performed without growing
   * curDamage, then re-search returns another non-damaging action — loop. Cap
   * total invocations per turn so worst-case bounded; the heuristic still gets
   * to drive the back half of the turn.
   *
   * Empirically: cap=3 runs cleanly at ~46ms on the seed-2000014 hang case;
   * cap≥4 hangs. There's a deeper state-accumulation bug somewhere in the
   * lookahead+lethal interaction (likely seekCount or another bot member
   * not captured by gameSnapshot), but capping at 3 is a robust workaround
   * — most kills are decided in 1-2 lethal searches per turn anyway. */
  private lethalCallsThisTurn = 0;
  private lethalCallsTurn = -1;
  private static MAX_LETHAL_CALLS_PER_TURN = 3;

  constructor(deck: PlayerDeck, game: Game, turnOrder: number, name = "SquashV2 Bot", character = "Marsh") {
    super(deck, game, turnOrder, name, character);
  }

  protected override get evalProfile(): BotProfile {
    return "squashV2";
  }

  override selectAction(actions: GameActionInternal[], game: Game): GameActionInternal {
    if (
      !SquashV2Bot.lookaheadEnabled ||
      this.turnOrder !== 0 ||
      SquashBot.explorationRate > 0 ||
      actions.length < 2
    ) {
      return super.selectAction(actions, game);
    }

    // Total wallclock budget for one decision. Under heavy load the lethal +
    // chain lookahead can compound past their per-stage budgets; this is a
    // hard backstop. If we exceed, fall back to heuristic-only via super.
    const decisionStart = Date.now();
    const decisionBudgetMs = 250;

    // Lethal solver: when opp HP is in striking range, do a greedy depth
    // search for kill sequences. If lethal exists, return the next step on
    // the kill path.
    //
    // Per-turn cache: skip re-searching if we already proved "no lethal" at
    // the current curDamage on this turn. curDamage is monotonic per turn
    // (resets at end_actions), so re-searching only matters when it grows.
    const opp = game.players[(this.turnOrder + 1) % 2];
    if (opp.curHealth > 0 && opp.curHealth <= SquashV2Bot.lethalThreshold) {
      // Reset per-turn invocation counter on turn change.
      if (this.lethalCallsTurn !== game.turncount) {
        this.lethalCallsTurn = game.turncount;
        this.lethalCallsThisTurn = 0;
      }
      const cacheValid =
        this.lethalSearchedTurn === game.turncount &&
        this.lethalSearchedCurDamage >= this.curDamage;
      const overCap = this.lethalCallsThisTurn >= SquashV2Bot.MAX_LETHAL_CALLS_PER_TURN;
      if (!cacheValid && !overCap) {
        this.lethalCallsThisTurn += 1;
        const lethal = this.findLethalAction(actions, game);
        // Cache the search outcome BEFORE returning so subsequent calls at
        // the same (turn, curDamage) don't repeat the work — even when we
        // returned a positive result. The lethal action gets performed, state
        // changes, and on the next call curDamage may have grown — that
        // invalidates the cache and we re-search.
        this.lethalSearchedTurn = game.turncount;
        this.lethalSearchedCurDamage = this.curDamage;
        if (lethal) return lethal;
      }
    }

    // Decision budget already exhausted from lethal solver alone? Fall back
    // to heuristic-only.
    if (Date.now() - decisionStart > decisionBudgetMs) {
      return super.selectAction(actions, game);
    }

    const { scored } = this.scoreAndSortActions(actions, game);
    const candidates = scored.slice(0, SquashV2Bot.lookaheadTopK);

    const stateBefore = snapshotGame(game);
    let bestAction: GameActionInternal = candidates[0].action;
    let bestValue = -Infinity;

    // Chain-lookahead wall-clock budget. Combined with the lethal solver,
    // pathological game states can compound — bail and use the heuristic best
    // (candidates[0]) if K simulations don't all finish in time.
    const chainStart = Date.now();
    const chainBudgetMs = Math.max(20, decisionBudgetMs - (chainStart - decisionStart));

    const self = this as Player & { _simulating?: boolean };
    const wasSimulating = self._simulating;
    self._simulating = true;
    try {
      for (const cand of candidates) {
        if (Date.now() - chainStart > chainBudgetMs) break;
        const action = cand.action;
        let value: number = cand.score;

        if (action.type !== "end_actions") {
          try {
            this.performAction(action, game);
            if (game.winner === this) value += 1000;
            else if (game.winner && game.winner !== this) value -= 1000;
            else {
              const nextActions = this.availableActions(game);
              if (nextActions.length > 0) {
                const { scored: nextScored } = this.scoreAndSortActions(nextActions, game);
                let followup = nextScored[0]?.score ?? 0;
                // 2-ply: recurse one more level on the best follow-up
                if (SquashV2Bot.lookaheadDepth >= 2 && nextScored.length > 0 && nextScored[0].action.type !== "end_actions") {
                  const innerSnap = snapshotGame(game);
                  try {
                    this.performAction(nextScored[0].action, game);
                    if (game.winner === this) followup += 1000;
                    else if (game.winner && game.winner !== this) followup -= 1000;
                    else {
                      const lvl2Actions = this.availableActions(game);
                      if (lvl2Actions.length > 0) {
                        const { scored: lvl2Scored } = this.scoreAndSortActions(lvl2Actions, game);
                        const lvl2 = lvl2Scored[0]?.score ?? 0;
                        followup += lvl2 * SquashV2Bot.followupWeight;
                      }
                    }
                  } catch {
                    // skip
                  } finally {
                    restoreGame(game, innerSnap);
                  }
                }
                value += followup * SquashV2Bot.followupWeight;
              }
            }
          } catch {
            // Sim failed — keep heuristic value
          } finally {
            restoreGame(game, stateBefore);
          }
        }

        if (value > bestValue) {
          bestValue = value;
          bestAction = action;
        }
      }
    } finally {
      self._simulating = wasSimulating;
    }

    if (bestAction.type === "end_actions") {
      (this as unknown as { actionCount: number }).actionCount = 0;
    } else {
      const ac = this as unknown as { actionCount?: number };
      ac.actionCount = (ac.actionCount ?? 0) + 1;
      if (ac.actionCount > 200) {
        ac.actionCount = 0;
        return actions.find((a) => a.type === "end_actions")!;
      }
    }

    return bestAction;
  }

  /**
   * Lethal solver — copy of ZoomBot.findLethalAction, no seat-specific logic.
   * Returns the FIRST action of a kill sequence, or null if none found.
   */
  private findLethalAction(
    actions: GameActionInternal[],
    game: Game,
  ): GameActionInternal | null {
    const opp = game.players[(this.turnOrder + 1) % 2];
    const oppDefenderHP = opp.allies.reduce((s, a) => s + (a.defender ? a.health : 0), 0);
    const damageNeeded = opp.curHealth + oppDefenderHP;

    const damageCandidates = actions.filter((a) =>
      a.type !== "end_actions" && a.type !== "buy_boxing"
    );
    if (damageCandidates.length === 0) return null;

    // Wall-clock budget. Kills decided fast in practice; long searches that
    // can't reach lethal hit pathological card-set states (e.g. lots of
    // atium-burn options × 12-depth × ~15 damage candidates compound). Bail
    // and let the heuristic drive the rest of the turn.
    const startTime = Date.now();
    const budgetMs = 50;

    const stateBefore = snapshotGame(game);
    let lethalFirstAction: GameActionInternal | null = null;
    let bestLethalDamage = -Infinity;

    const self = this as Player & { _simulating?: boolean };
    const wasSimulating = self._simulating;
    self._simulating = true;

    try {
      for (const first of damageCandidates) {
        if (Date.now() - startTime > budgetMs) break;
        try {
          this.performAction(first, game);
          if (game.winner === this) {
            restoreGame(game, stateBefore);
            return first;
          }
          let damageBuilt = this.curDamage;
          for (let depth = 0; depth < 12; depth++) {
            if (Date.now() - startTime > budgetMs) break;
            const next = this.availableActions(game);
            const damaging = next.filter((a) => a.type !== "end_actions" && a.type !== "buy_boxing");
            if (damaging.length === 0) break;
            const { scored } = this.scoreAndSortActions(damaging, game);
            const best = scored[0]?.action;
            if (!best) break;
            try {
              this.performAction(best, game);
            } catch {
              break;
            }
            if (game.winner === this) {
              restoreGame(game, stateBefore);
              return first;
            }
            damageBuilt = Math.max(damageBuilt, this.curDamage);
          }
          if (this.curDamage >= damageNeeded && this.curDamage > bestLethalDamage) {
            bestLethalDamage = this.curDamage;
            lethalFirstAction = first;
          }
        } catch {
          // skip
        } finally {
          restoreGame(game, stateBefore);
        }
      }
    } finally {
      self._simulating = wasSimulating;
    }

    return lethalFirstAction;
  }
}

/** Factory function for creating SquashV2 bots */
export function createSquashV2Bot(
  deck: PlayerDeck,
  game: Game,
  turnOrder: number,
  name: string,
  character: string,
): Player {
  return new SquashV2Bot(deck, game, turnOrder, name, character);
}
