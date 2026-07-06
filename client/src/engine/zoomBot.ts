/**
 * ZoomBot — going-second specialist. Same scoring methodology as SquashBot
 * (state-aware action scoring + first-principles analytical card values
 * blended with self-play correlations and acquisition-timing data), but
 * trained on a corpus of mirror games where only the SECOND-PLAYER seat is
 * recorded. This pushes Zoom's card weights toward whatever wins from a
 * tempo-deficit position rather than toward the average mirror outcome.
 *
 * Lookahead: when enabled, ZoomBot does 1-ply state-value lookahead in seat
 * 2 — for each candidate action, snapshot game → simulate the action →
 * score the resulting state → restore. Pick action whose resulting state
 * scores highest. Captures "what's the state value AFTER this action" rather
 * than "what's the immediate effect value of this action," which lets Zoom
 * see cascading effects (e.g. burning a metal that unlocks another card's
 * tier-2 ability vs just the burn's direct value).
 */

import type { Game } from "./game";
import type { Player } from "./player";
import type { PlayerDeck } from "./deck";
import { SquashBot } from "./squashBot";
import { type BotProfile } from "./squashBotEval";
import type { GameActionInternal } from "./types";
import { snapshotGame, restoreGame } from "./gameSnapshot";

export class ZoomBot extends SquashBot {
  static seat2Variance = 0;

  /** Enable 1-ply heuristic-chain lookahead in seat 2. Each candidate's value
   * is its immediate heuristic plus a discounted contribution from the
   * heuristic-best follow-up in the post-action state. Captures "X enables Y"
   * effects. ~2× slower than heuristic-only at runtime.
   *
   * Off during self-play training (clean signal needed; lookahead-trained
   * data regressed in testing). */
  static lookaheadEnabled = true;

  /** When opp HP ≤ this, do a tactical lethal search before normal action
   * selection. Pattern from chess endgame solvers / Hearthstone lethal calc. */
  static lethalThreshold = 14;

  /** Top-K candidates from heuristic scoring to apply lookahead to.
   * K=2 narrowly beat K=3 globally (39.26% vs 39.08% over 40k samples). */
  static lookaheadTopK = 2;

  /** Discount on follow-up heuristic value vs immediate.
   * 0.55-0.65 tied around 39.6%; 0.8 was 39.3%. Lower weight prevents the
   * lookahead from over-trusting noisy follow-up estimates. */
  static followupWeight = 0.6;

  /** Lookahead depth. 1 = 1-ply chain (validated default). 2 = recurse one
   * more level on the best follow-up, discounted by followupWeight again —
   * same shape as SquashV2Bot's 2-ply. */
  static lookaheadDepth = 1;

  // Per-turn lethal-cache + invocation cap — same as SquashV2Bot. Without it,
  // late-game turns where opp HP is low can spend many seconds re-running the
  // 12-step greedy lookahead per selectAction call. Empirically cap=3 is
  // robust; 4+ hangs on certain (Kelsier-Marsh, etc.) seeds when chain
  // lookahead K=2 is also active.
  private lethalSearchedTurn = -1;
  private lethalSearchedCurDamage = -1;
  private lethalCallsThisTurn = 0;
  private lethalCallsTurn = -1;
  private static MAX_LETHAL_CALLS_PER_TURN = 3;

  constructor(deck: PlayerDeck, game: Game, turnOrder: number, name = "Zoom Bot", character = "Marsh") {
    super(deck, game, turnOrder, name, character);
  }

  protected override get evalProfile(): BotProfile {
    return "zoom";
  }

  // ── Instance-level lookahead knobs ──
  // Default to the class statics (behavior-neutral). Subclasses (AnvilBot)
  // override per evolved policy without touching the shared statics — statics
  // are shared with any same-class opponent in a bench.
  protected get lookTopK(): number { return ZoomBot.lookaheadTopK; }
  protected get lookFollowupWeight(): number { return ZoomBot.followupWeight; }
  protected get lookDepth(): number { return ZoomBot.lookaheadDepth; }
  protected get lookLethalThreshold(): number { return ZoomBot.lethalThreshold; }
  /** Score-gap pruning gate: skip chain lookahead when the heuristic best
   * beats the runner-up by at least this margin. 0 = off. */
  protected get lookGapGate(): number { return 0; }

  /** Whether an action may serve as the credited follow-up in the chain
   * lookahead. Default: all. Subclasses exclude EV-neutral resource
   * conversions (use_boxing/buy_boxing) — crediting them lets buy_boxing
   * "earn" the value of the use_boxing it enables (a -1 money round trip). */
  protected followupEligible(_action: GameActionInternal): boolean { return true; }

  // ── Simulated-candidate valuation hooks ──
  // Defaults reproduce the validated heuristic-chain behavior exactly.
  // Subclasses (AnvilSecondBot's value-leaf mode) swap in a learned state
  // evaluation without touching the lookahead scaffolding.

  /** Value of a simulated candidate that immediately ended the game. */
  protected simTerminalValue(immediateScore: number, won: boolean): number {
    return immediateScore + (won ? 1000 : -1000);
  }

  /** Value of the (non-terminal) post-action state. Default: heuristic-chain
   * follow-up — immediate score plus the discounted best follow-up score,
   * with optional 2-ply recursion. Called with `game` already advanced by
   * the candidate action; must not mutate it un-restorably (any inner sim
   * snapshots/restores locally). */
  protected simStateValue(immediateScore: number, game: Game): number {
    const nextActions = this.availableActions(game);
    if (nextActions.length === 0) return immediateScore;
    const { scored: nextScored } = this.scoreAndSortActions(nextActions, game);
    const fu = nextScored.find((s) => this.followupEligible(s.action));
    let followup = fu?.score ?? 0;
    // 2-ply: recurse one more level on the best follow-up
    if (this.lookDepth >= 2 && fu && fu.action.type !== "end_actions") {
      const innerSnap = snapshotGame(game);
      try {
        this.performAction(fu.action, game);
        if (game.winner === this) followup += 1000;
        else if (game.winner && game.winner !== this) followup -= 1000;
        else {
          const lvl2Actions = this.availableActions(game);
          if (lvl2Actions.length > 0) {
            const { scored: lvl2Scored } = this.scoreAndSortActions(lvl2Actions, game);
            followup += (lvl2Scored[0]?.score ?? 0) * this.lookFollowupWeight;
          }
        }
      } catch {
        // skip
      } finally {
        restoreGame(game, innerSnap);
      }
    }
    return immediateScore + followup * this.lookFollowupWeight;
  }

  /** Value of the end_actions candidate (never simulated — cleanup draws
   * would leak hidden information). Default: its heuristic score. */
  protected endActionsValue(immediateScore: number, _game: Game): number {
    return immediateScore;
  }

  override selectAction(actions: GameActionInternal[], game: Game): GameActionInternal {
    if (
      !ZoomBot.lookaheadEnabled ||
      this.turnOrder !== 1 ||
      SquashBot.explorationRate > 0 ||
      actions.length < 2
    ) {
      return super.selectAction(actions, game);
    }

    // Total wallclock budget for one decision (hard backstop).
    const decisionStart = Date.now();
    const decisionBudgetMs = 250;

    // Lethal solver: when opp HP is in striking range, do a greedy depth
    // search for kill sequences. If lethal exists, return the next step on
    // the kill path. Cheap & effective — research-doc-recommended pattern.
    //
    // Per-turn cache + invocation cap to prevent unbounded re-search when
    // the solver returns non-damage-producing first actions (use_boxing,
    // burn_card) that don't grow curDamage but still get performed. See
    // SquashV2Bot for the same fix.
    const opp = game.players[(this.turnOrder + 1) % 2];
    if (opp.curHealth > 0 && opp.curHealth <= this.lookLethalThreshold) {
      if (this.lethalCallsTurn !== game.turncount) {
        this.lethalCallsTurn = game.turncount;
        this.lethalCallsThisTurn = 0;
      }
      const cacheValid =
        this.lethalSearchedTurn === game.turncount &&
        this.lethalSearchedCurDamage >= this.curDamage;
      const overCap = this.lethalCallsThisTurn >= ZoomBot.MAX_LETHAL_CALLS_PER_TURN;
      if (!cacheValid && !overCap) {
        this.lethalCallsThisTurn += 1;
        const lethal = this.findLethalAction(actions, game);
        this.lethalSearchedTurn = game.turncount;
        this.lethalSearchedCurDamage = this.curDamage;
        if (lethal) return lethal;
      }
    }

    // Bail if lethal already used up the budget.
    if (Date.now() - decisionStart > decisionBudgetMs) {
      return super.selectAction(actions, game);
    }

    // Heuristic scoring narrows the candidate set.
    const { scored } = this.scoreAndSortActions(actions, game);
    // Gap gate: when the best action already dominates, don't spend the
    // decision budget second-guessing it.
    const gated =
      this.lookGapGate > 0 &&
      scored.length > 1 &&
      scored[0].score - scored[1].score >= this.lookGapGate;
    const candidates = gated ? [] : scored.slice(0, this.lookTopK);

    const stateBefore = snapshotGame(game);
    let bestAction: GameActionInternal = scored[0].action;
    let bestValue = -Infinity;

    // Chain-lookahead wall-clock budget — same fix as SquashV2.
    const chainStart = Date.now();
    const chainBudgetMs = Math.max(20, decisionBudgetMs - (chainStart - decisionStart));

    // Mark this bot as simulating so the session's performAction wrapper
    // skips logging during candidate evaluation. Cleared after the loop.
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
            if (game.winner === this) value = this.simTerminalValue(cand.score, true);
            else if (game.winner && game.winner !== this) value = this.simTerminalValue(cand.score, false);
            else value = this.simStateValue(cand.score, game);
          } catch {
            // Sim failed — keep heuristic value
          } finally {
            restoreGame(game, stateBefore);
          }
        } else {
          value = this.endActionsValue(cand.score, game);
        }

        if (value > bestValue) {
          bestValue = value;
          bestAction = action;
        }
      }
    } finally {
      self._simulating = wasSimulating;
    }

    // Reset action count when ending turn (mirrors SquashBot's behavior)
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
   * Lethal solver: starting from `actions`, search for a sequence that ends
   * in opp's death this turn. Returns the FIRST action of the kill sequence
   * (or null if no kill found within the depth/breadth budget).
   *
   * Strategy: greedy by damage-priority — try damage-producing actions first,
   * accumulate curDamage, simulate game.attack at each "could-end-turn" point.
   * If accumulated damage exceeds opp HP (after defenders), found lethal.
   *
   * Bounded by max actions per branch; uses snapshot/restore to avoid game
   * state corruption. Cost: ~5-15 simulations per call when in striking range.
   */
  private findLethalAction(
    actions: GameActionInternal[],
    game: Game,
  ): GameActionInternal | null {
    const opp = game.players[(this.turnOrder + 1) % 2];
    const oppDefenderHP = opp.allies.reduce((s, a) => s + (a.defender ? a.health : 0), 0);
    const damageNeeded = opp.curHealth + oppDefenderHP;

    // Quick-check: rank candidate actions by IMMEDIATE damage potential.
    // For each candidate, simulate; if game.winner becomes us within rollout, lethal.
    const damageCandidates = actions.filter((a) =>
      a.type !== "end_actions" && a.type !== "buy_boxing"
    );
    if (damageCandidates.length === 0) return null;

    // Wall-clock budget. Some pathological card-set states (lots of atium-burn
    // options × 12-depth × ~15 candidates) blow past expected runtime. Bail
    // and fall back to the heuristic for the rest of the turn.
    const startTime = Date.now();
    const budgetMs = 50;

    const stateBefore = snapshotGame(game);
    let lethalFirstAction: GameActionInternal | null = null;
    let bestLethalDamage = -Infinity;

    // Suppress activity-log entries from the lethal-search simulations
    // (parallels chooseAction's lookahead loop). Wrapped in try/finally so
    // the flag is cleared on any return path including the "direct kill"
    // and "won mid-rollout" early returns below.
    const self = this as Player & { _simulating?: boolean };
    const wasSimulating = self._simulating;
    self._simulating = true;

    try {
      for (const first of damageCandidates) {
        if (Date.now() - startTime > budgetMs) break;
        try {
          this.performAction(first, game);
          if (game.winner === this) {
            // Direct kill — already best.
            restoreGame(game, stateBefore);
            return first;
          }
          // Greedy follow-up: keep performing highest-damage actions until end_actions
          // or no more damage moves.
          let damageBuilt = this.curDamage;
          for (let depth = 0; depth < 12; depth++) {
            if (Date.now() - startTime > budgetMs) break;
            const next = this.availableActions(game);
            // Prefer actions that build curDamage
            const damaging = next.filter((a) => a.type !== "end_actions" && a.type !== "buy_boxing");
            if (damaging.length === 0) break;
            // Use heuristic to pick best — but bias toward damage by checking curDamage
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
          // Check if accumulated damage would kill (curDamage at end of branch)
          if (this.curDamage >= damageNeeded && this.curDamage > bestLethalDamage) {
            bestLethalDamage = this.curDamage;
            lethalFirstAction = first;
          }
        } catch {
          // Skip failed branches
        } finally {
          restoreGame(game, stateBefore);
        }
      }
    } finally {
      self._simulating = wasSimulating;
    }

    return lethalFirstAction;
  }

  protected override maybeOverridePick(
    picked: GameActionInternal,
    scored: { action: GameActionInternal; score: number }[],
  ): GameActionInternal {
    // Variance hook (kept for testing — disabled by default since it regressed)
    if (SquashBot.explorationRate > 0) return picked;
    if (ZoomBot.seat2Variance <= 0) return picked;
    if (this.turnOrder !== 1) return picked;
    if (picked.type === "end_actions") return picked;
    if (this.rng.next() >= ZoomBot.seat2Variance) return picked;

    const candidates = scored
      .filter((s) => s.action.type !== "end_actions")
      .slice(0, 3)
      .map((s) => s.action);
    if (candidates.length < 2) return picked;
    return candidates[this.rng.nextInt(candidates.length)];
  }
}

/** Factory function for creating Zoom bots */
export function createZoomBot(
  deck: PlayerDeck,
  game: Game,
  turnOrder: number,
  name: string,
  character: string,
): Player {
  return new ZoomBot(deck, game, turnOrder, name, character);
}
