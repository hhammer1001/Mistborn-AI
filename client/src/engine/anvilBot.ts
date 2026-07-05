/**
 * Anvil — evolved composite bot (successor to Hulk X90).
 *
 * Same seat-specialist composition as Hulk (SquashV3 going first, Zoom going
 * second) plus a per-character, per-seat *evolved policy* with two gene
 * families:
 *
 *   deltas — per-market-card rating deltas injected at cardRating, flowing
 *     through buys, boxing redemption, eliminates, pulls, market pushes and
 *     the chain lookahead (Provincial-style acquisition tuning).
 *   knobs — joint shifts to the heuristic's core assumptions (score bases,
 *     buy multiplier, end-turn bias, flare/burn costs) and the lookahead
 *     shape (top-K, depth, follow-up discount, lethal threshold, score-gap
 *     pruning gate). Single-knob sweeps plateaued in BOT_NOTES; the evolver
 *     moves many at once to escape the local optimum.
 *
 * Policies are trained by anvilEvolve.ts against the Hulk counterpart of the
 * opposite seat and committed to data/anvil_policy.json. An empty policy
 * makes Anvil behave exactly like Hulk (verified game-for-game on seeds).
 */

import type { Game } from "./game";
import type { Player } from "./player";
import type { PlayerDeck } from "./deck";
import type { Card } from "./card";
import type { GameStateSnapshot } from "./squashBotEval";
import type { GameActionInternal } from "./types";
import { SquashBot } from "./squashBot";
import { SquashV3Bot } from "./squashV3Bot";
import { SquashV2Bot } from "./squashV2Bot";
import { ZoomBot } from "./zoomBot";
import { winProb, valueModelAvailable } from "./valueModel";
import { snapshotGame, restoreGame } from "./gameSnapshot";
import committedPolicy from "./data/anvil_policy.json";

/** cardName -> rating delta. Applied on top of dynamicCardRating. */
export type AnvilDeltas = Record<string, number>;
/** knob key -> value. Missing key = base behavior. */
export type AnvilKnobs = Record<string, number>;

export interface AnvilCharPolicy {
  deltas?: AnvilDeltas;
  knobs?: AnvilKnobs;
}
export type AnvilSeatPolicy = Record<string, AnvilCharPolicy>;
export interface AnvilPolicy {
  first: AnvilSeatPolicy; // seat 0 (extends SquashV3)
  second: AnvilSeatPolicy; // seat 1 (extends Zoom)
}

/** Knob definitions shared with the evolver: [min, max, mutationSigma, isInt].
 * Additive score knobs default to 0; *Mult knobs default to 1; look* knobs
 * default to the base bot's value. */
export const ANVIL_KNOB_DEFS: Record<string, { min: number; max: number; sigma: number; int?: boolean; mult?: boolean; look?: boolean }> = {
  missionAdd: { min: -30, max: 30, sigma: 4 },
  missionMult: { min: 0.7, max: 1.4, sigma: 0.06, mult: true },
  useMetalAdd: { min: -15, max: 15, sigma: 2.5 },
  allyAdd: { min: -15, max: 15, sigma: 2.5 },
  charAbilityAdd: { min: -15, max: 15, sigma: 2.5 },
  buyAdd: { min: -15, max: 15, sigma: 2.5 },
  buyMult: { min: 0.6, max: 1.6, sigma: 0.08, mult: true },
  flareAdd: { min: -2, max: 2, sigma: 0.4 },
  burnMetalAdd: { min: -2, max: 2, sigma: 0.4 },
  burnCardAdd: { min: -4, max: 4, sigma: 0.7 },
  endTurnAdd: { min: -10, max: 10, sigma: 1.5 },
  refreshAdd: { min: -8, max: 8, sigma: 1.2 },
  atiumAdd: { min: -6, max: 6, sigma: 1.0 },
  boxingUseAdd: { min: -6, max: 6, sigma: 1.0 },
  lookTopK: { min: 1, max: 5, sigma: 1, int: true, look: true },
  lookFollowupWeight: { min: 0.2, max: 1.0, sigma: 0.08, look: true },
  lookDepth: { min: 1, max: 2, sigma: 1, int: true, look: true },
  lookLethalThreshold: { min: 8, max: 22, sigma: 2, int: true, look: true },
  lookGapGate: { min: 0, max: 80, sigma: 8, look: true },
};

const policy: AnvilPolicy = {
  first: { ...(committedPolicy as AnvilPolicy).first },
  second: { ...(committedPolicy as AnvilPolicy).second },
};

/** Replace the active policy for one seat+character (used by the evolution
 * harness to evaluate candidate genomes without touching the committed file). */
export function setAnvilPolicy(
  seat: keyof AnvilPolicy,
  character: string,
  charPolicy: AnvilCharPolicy,
): void {
  policy[seat][character] = charPolicy;
}

export function getAnvilPolicy(): AnvilPolicy {
  return policy;
}

// Shared knob lookups so the two seat classes can't drift.
function kAdd(seat: keyof AnvilPolicy, character: string, key: string): number {
  return policy[seat][character]?.knobs?.[key] ?? 0;
}
function kMult(seat: keyof AnvilPolicy, character: string, key: string): number {
  return policy[seat][character]?.knobs?.[key] ?? 1;
}
function kLook(seat: keyof AnvilPolicy, character: string, key: string): number | undefined {
  return policy[seat][character]?.knobs?.[key];
}
function kDelta(seat: keyof AnvilPolicy, character: string, cardName: string): number {
  return policy[seat][character]?.deltas?.[cardName] ?? 0;
}

// ── Shared value-veto machinery ──
// Both seat classes use these module-level helpers; each passes a `rank`
// closure over its protected scoreAndSortActions so there is exactly one
// implementation of the rollout and the veto (CLAUDE.md: no parallel copies).

type RankFn = (actions: GameActionInternal[], game: Game) => { action: GameActionInternal; score: number }[];

/** Greedily play out the rest of the turn (heuristic-best actions, stop when
 * end_actions tops the ranking), then mirror playTurn's close (assignDamage →
 * attack → damage reset) and return the P(win)-scaled value of the boundary
 * state. Mutates `game`; caller restores. */
function rolloutTurnEndValue(bot: Player, game: Game, rank: RankFn): number {
  for (let step = 0; step < 15; step++) {
    if (game.winner) break;
    const actions = bot.availableActions(game);
    if (actions.length === 0) break;
    const best = rank(actions, game)[0]?.action;
    if (!best || best.type === "end_actions") break;
    try {
      bot.performAction(best, game);
      game.drainPendingKills();
    } catch {
      break;
    }
  }
  return finishTurnAndEvaluate(bot, game);
}

/** Mirror playTurn's post-action sequence, then — when the opponent is a
 * simulatable bot — play out the opponent's full reply turn (heuristic-only:
 * lookahead statics off, recursion-guarded via _simulating) and evaluate
 * P(win) at the post-reply boundary (postOppTurn=1). This sees "if I end my
 * turn like this, the opponent kills me / closes a mission" — invisible to
 * the own-turn-end evaluation. Falls back to the own-turn-end phase
 * (postOppTurn=0) when the opponent can't be simulated (e.g. a human). */
function finishTurnAndEvaluate(bot: Player, game: Game): number {
  if (!game.winner) {
    bot.assignDamage(game);
    game.attack(bot);
  }
  if (game.winner === bot) return 2000;
  if (game.winner) return -2000;
  bot.curDamage = 0;

  const opp = game.players[(bot.turnOrder + 1) % 2];
  if (!(opp instanceof SquashBot)) return 1000 * winProb(bot, game, 0);

  const oppSim = opp as Player & { _simulating?: boolean };
  const wasSim = oppSim._simulating;
  const v2Look = SquashV2Bot.lookaheadEnabled;
  const zoomLook = ZoomBot.lookaheadEnabled;
  oppSim._simulating = true;
  SquashV2Bot.lookaheadEnabled = false;
  ZoomBot.lookaheadEnabled = false;
  try {
    game.turncount += 1; // playTurn-adjacent bookkeeping the Game.play loop does
    opp.playTurn(game);
  } catch {
    // Reply sim failed — fall back to the own-turn-end phase.
    return 1000 * winProb(bot, game, 0);
  } finally {
    oppSim._simulating = wasSim;
    SquashV2Bot.lookaheadEnabled = v2Look;
    ZoomBot.lookaheadEnabled = zoomLook;
  }
  if (game.winner === bot) return 2000;
  if (game.winner) return -2000;
  return 1000 * winProb(bot, game, 1);
}

/** Veto selection: compute rollout P(win) for the heuristic pick and the
 * other top-K candidates; return an alternative only when it beats the pick
 * by >= margin. Bounds model exploitation — the bot IS the heuristic except
 * on high-confidence strategic disagreements. */
function vetoSelect(
  bot: Player,
  game: Game,
  actions: GameActionInternal[],
  heuristicPick: GameActionInternal,
  topK: number,
  margin: number,
  rank: RankFn,
): GameActionInternal {
  const candidates = rank(actions, game).slice(0, topK);
  if (!candidates.some((c) => c.action === heuristicPick)) {
    candidates.push({ action: heuristicPick, score: 0 });
  }
  const self = bot as Player & { _simulating?: boolean };
  const wasSimulating = self._simulating;
  self._simulating = true;
  const stateBefore = snapshotGame(game);
  let pickP = -1;
  let bestAlt: GameActionInternal | null = null;
  let bestAltP = -1;
  try {
    for (const cand of candidates) {
      let p: number;
      try {
        if (cand.action.type !== "end_actions") {
          bot.performAction(cand.action, game);
          if (game.winner === bot) p = 2;
          else if (game.winner) p = -2;
          else p = rolloutTurnEndValue(bot, game, rank) / 1000;
        } else {
          p = finishTurnAndEvaluate(bot, game) / 1000;
        }
      } catch {
        p = -1;
      } finally {
        restoreGame(game, stateBefore);
      }
      if (cand.action === heuristicPick) pickP = p;
      else if (p > bestAltP) { bestAltP = p; bestAlt = cand.action; }
    }
  } finally {
    self._simulating = wasSimulating;
  }
  if (bestAlt && bestAltP - pickP >= margin) return bestAlt;
  return heuristicPick;
}

// The two seat classes carry identical one-line overrides delegating to the
// shared lookups above (a TS mixin over protected members doesn't typecheck,
// so the pairing is kept trivially thin instead — all logic lives in the
// helpers and the policy data).

export class AnvilFirstBot extends SquashV3Bot {
  /** Seat-0 value veto — same shape as AnvilSecondBot's shipped config but
   * OFF by default: seat 0 has less headroom and is unvalidated. Enable via
   * anvilBench env ANVIL_VL_SEAT0=1 for A/B. */
  static valueVetoMargin = 0;
  static valueLeafTopK = 6;

  constructor(deck: PlayerDeck, game: Game, turnOrder: number, name = "Anvil Bot", character = "Marsh") {
    super(deck, game, turnOrder, name, character);
  }

  private rankFn: RankFn = (as, g) => this.scoreAndSortActions(as, g).scored;

  override selectAction(actions: GameActionInternal[], game: Game): GameActionInternal {
    const margin = AnvilFirstBot.valueVetoMargin;
    const simulating = (this as Player & { _simulating?: boolean })._simulating;
    if (margin <= 0 || !valueModelAvailable() || this.turnOrder !== 0 || actions.length < 2 || simulating) {
      return super.selectAction(actions, game);
    }
    const heuristicPick = super.selectAction(actions, game);
    return vetoSelect(this, game, actions, heuristicPick, AnvilFirstBot.valueLeafTopK, margin, this.rankFn);
  }

  protected override cardRating(card: Card, snap: GameStateSnapshot): number {
    return super.cardRating(card, snap) + kDelta("first", this.character, card.name);
  }

  // ── Heuristic-assumption knobs ──
  protected override scoreMissionAdvance(a: GameActionInternal & { type: "advance_mission" }, s: GameStateSnapshot): number {
    return super.scoreMissionAdvance(a, s) * kMult("first", this.character, "missionMult") + kAdd("first", this.character, "missionAdd");
  }
  protected override scoreUseMetal(a: GameActionInternal & { type: "use_metal" }, s: GameStateSnapshot): number {
    return super.scoreUseMetal(a, s) + kAdd("first", this.character, "useMetalAdd");
  }
  protected override scoreAllyAbility(a: GameActionInternal & { type: "ally_ability_1" | "ally_ability_2" }, s: GameStateSnapshot, tier: number): number {
    return super.scoreAllyAbility(a, s, tier) + kAdd("first", this.character, "allyAdd");
  }
  protected override scoreCharAbility1(s: GameStateSnapshot): number {
    return super.scoreCharAbility1(s) + kAdd("first", this.character, "charAbilityAdd");
  }
  protected override scoreCharAbility3(s: GameStateSnapshot): number {
    return super.scoreCharAbility3(s) + kAdd("first", this.character, "charAbilityAdd");
  }
  protected override scoreBuy(a: GameActionInternal & { type: "buy" }, s: GameStateSnapshot): number {
    const base = super.scoreBuy(a, s);
    if (base <= -10) return base; // below-buffer sentinel — leave rejects alone
    return base * kMult("first", this.character, "buyMult") + kAdd("first", this.character, "buyAdd");
  }
  protected override scoreFlare(a: GameActionInternal & { type: "flare_metal" }, s: GameStateSnapshot): number {
    return super.scoreFlare(a, s) + kAdd("first", this.character, "flareAdd");
  }
  protected override scoreBurnMetal(a: GameActionInternal & { type: "burn_metal" }, s: GameStateSnapshot): number {
    return super.scoreBurnMetal(a, s) + kAdd("first", this.character, "burnMetalAdd");
  }
  protected override scoreBurnCard(a: GameActionInternal & { type: "burn_card" }, s: GameStateSnapshot): number {
    return super.scoreBurnCard(a, s) + kAdd("first", this.character, "burnCardAdd");
  }
  protected override scoreEndTurn(s: GameStateSnapshot): number {
    return super.scoreEndTurn(s) + kAdd("first", this.character, "endTurnAdd");
  }
  protected override scoreRefresh(a: GameActionInternal & { type: "refresh_metal" }, s: GameStateSnapshot): number {
    return super.scoreRefresh(a, s) + kAdd("first", this.character, "refreshAdd");
  }
  protected override scoreUseBoxing(s: GameStateSnapshot): number {
    return super.scoreUseBoxing(s) + kAdd("first", this.character, "boxingUseAdd");
  }
  protected override scoreUseAtium(a: GameActionInternal & { type: "use_atium" }, s: GameStateSnapshot): number {
    return super.scoreUseAtium(a, s) + kAdd("first", this.character, "atiumAdd");
  }

  // ── Lookahead-shape knobs ──
  protected override get lookTopK(): number { return kLook("first", this.character, "lookTopK") ?? super.lookTopK; }
  protected override get lookFollowupWeight(): number { return kLook("first", this.character, "lookFollowupWeight") ?? super.lookFollowupWeight; }
  protected override get lookDepth(): number { return kLook("first", this.character, "lookDepth") ?? super.lookDepth; }
  protected override get lookLethalThreshold(): number { return kLook("first", this.character, "lookLethalThreshold") ?? super.lookLethalThreshold; }
  protected override get lookGapGate(): number { return kLook("first", this.character, "lookGapGate") ?? super.lookGapGate; }
}

export class AnvilSecondBot extends ZoomBot {
  /** Value-leaf mode: compare lookahead candidates by learned P(win) of the
   * simulated post-action state instead of the heuristic follow-up chain.
   * All candidates (including end_actions, valued at the CURRENT state's
   * P(win)) live on one scale, fixing the scale mismatch that killed the
   * earlier naive state-value lookahead. Requires trained value weights. */
  /** Value-model integration. SHIPPED CONFIG: veto mode at margin 0.08 —
   * play the heuristic's pick unless another top-K candidate's end-of-turn
   * rollout P(win) beats the pick's by >= the margin. Validated +3.2pp avg
   * on seat1 vs SquashV3 across 3 fresh seed ranges (+1.7/+5.2/+2.8).
   *
   * Pure value selection (valueVetoMargin=0, valueBlend=0) is adversarially
   * unstable — argmax against the observational model farms its blind spots
   * (0.1%-6% win rates across 4 attempts incl. a DAgger iteration). The veto
   * bounds exploitation: the bot IS the heuristic except on high-confidence
   * strategic disagreements. Guarded by valueModelAvailable(). */
  static valueLeafEnabled = true;
  /** Candidate breadth in value-leaf mode. State evaluation is cheap (one
   * dot product); the cost is performAction+restore, so a wider K than the
   * heuristic chain's 2 is affordable. */
  static valueLeafTopK = 6;
  /** Blend mode (experimental, off): > 0 = heuristic chain value plus
   * valueBlend x rollout P(win) value. Neutral at 0.3, harmful at 0.7. */
  static valueBlend = 0;
  /** Veto margin: see valueLeafEnabled. 0 = pure value selection (unstable). */
  static valueVetoMargin = 0.08;

  override selectAction(actions: GameActionInternal[], game: Game): GameActionInternal {
    const margin = AnvilSecondBot.valueVetoMargin;
    const simulating = (this as Player & { _simulating?: boolean })._simulating;
    if (!this.valueLeafOn || margin <= 0 || this.turnOrder !== 1 || actions.length < 2 || simulating) {
      return super.selectAction(actions, game);
    }
    // Heuristic decision first (value hooks stay heuristic in veto mode).
    const heuristicPick = super.selectAction(actions, game);
    return vetoSelect(this, game, actions, heuristicPick, AnvilSecondBot.valueLeafTopK, margin, this.rankFn);
  }

  private rankFn: RankFn = (as, g) => this.scoreAndSortActions(as, g).scored;

  private get valueLeafOn(): boolean {
    return AnvilSecondBot.valueLeafEnabled && valueModelAvailable();
  }

  // In veto mode the sim hooks must stay heuristic (the value comparison
  // happens in selectAction); only pure/blend modes redirect them.
  private get valueHooksOn(): boolean {
    return this.valueLeafOn && AnvilSecondBot.valueVetoMargin <= 0;
  }

  protected override get lookTopK(): number {
    if (this.valueLeafOn) return AnvilSecondBot.valueLeafTopK;
    return kLook("second", this.character, "lookTopK") ?? super.lookTopK;
  }

  protected override simTerminalValue(immediateScore: number, won: boolean): number {
    if (this.valueHooksOn) return won ? 2000 : -2000;
    return super.simTerminalValue(immediateScore, won);
  }

  protected override simStateValue(immediateScore: number, game: Game): number {
    // End-of-turn rollout: complete the turn greedily with the heuristic,
    // apply the attack, evaluate P(win) at the turn boundary — the same
    // phase point the model was trained on. Immediate-post-action evaluation
    // was abandoned: maximizing a cross-state model over MID-turn states
    // farms causally-invertible resource features (flare/burn-everything).
    // The caller restores the game after this returns; mutations are safe.
    if (this.valueHooksOn) {
      if (AnvilSecondBot.valueBlend > 0) {
        // Heuristic first (needs the unmutated post-candidate state), then
        // the rollout mutates freely — caller restores.
        const h = super.simStateValue(immediateScore, game);
        return h + AnvilSecondBot.valueBlend * rolloutTurnEndValue(this, game, this.rankFn);
      }
      return rolloutTurnEndValue(this, game, this.rankFn);
    }
    return super.simStateValue(immediateScore, game);
  }

  protected override endActionsValue(immediateScore: number, game: Game): number {
    // "End the turn now": no further actions, but the attack still resolves.
    // Caller does NOT restore for this path — snapshot locally.
    if (this.valueHooksOn) {
      const snap = snapshotGame(game);
      try {
        const v = finishTurnAndEvaluate(this, game);
        if (AnvilSecondBot.valueBlend > 0) {
          return super.endActionsValue(immediateScore, game) + AnvilSecondBot.valueBlend * v;
        }
        return v;
      } catch {
        return immediateScore;
      } finally {
        restoreGame(game, snap);
      }
    }
    return super.endActionsValue(immediateScore, game);
  }


  constructor(deck: PlayerDeck, game: Game, turnOrder: number, name = "Anvil Bot", character = "Marsh") {
    super(deck, game, turnOrder, name, character);
  }

  protected override cardRating(card: Card, snap: GameStateSnapshot): number {
    return super.cardRating(card, snap) + kDelta("second", this.character, card.name);
  }

  // ── Heuristic-assumption knobs ──
  protected override scoreMissionAdvance(a: GameActionInternal & { type: "advance_mission" }, s: GameStateSnapshot): number {
    return super.scoreMissionAdvance(a, s) * kMult("second", this.character, "missionMult") + kAdd("second", this.character, "missionAdd");
  }
  protected override scoreUseMetal(a: GameActionInternal & { type: "use_metal" }, s: GameStateSnapshot): number {
    return super.scoreUseMetal(a, s) + kAdd("second", this.character, "useMetalAdd");
  }
  protected override scoreAllyAbility(a: GameActionInternal & { type: "ally_ability_1" | "ally_ability_2" }, s: GameStateSnapshot, tier: number): number {
    return super.scoreAllyAbility(a, s, tier) + kAdd("second", this.character, "allyAdd");
  }
  protected override scoreCharAbility1(s: GameStateSnapshot): number {
    return super.scoreCharAbility1(s) + kAdd("second", this.character, "charAbilityAdd");
  }
  protected override scoreCharAbility3(s: GameStateSnapshot): number {
    return super.scoreCharAbility3(s) + kAdd("second", this.character, "charAbilityAdd");
  }
  protected override scoreBuy(a: GameActionInternal & { type: "buy" }, s: GameStateSnapshot): number {
    const base = super.scoreBuy(a, s);
    if (base <= -10) return base; // below-buffer sentinel — leave rejects alone
    return base * kMult("second", this.character, "buyMult") + kAdd("second", this.character, "buyAdd");
  }
  protected override scoreFlare(a: GameActionInternal & { type: "flare_metal" }, s: GameStateSnapshot): number {
    return super.scoreFlare(a, s) + kAdd("second", this.character, "flareAdd");
  }
  protected override scoreBurnMetal(a: GameActionInternal & { type: "burn_metal" }, s: GameStateSnapshot): number {
    return super.scoreBurnMetal(a, s) + kAdd("second", this.character, "burnMetalAdd");
  }
  protected override scoreBurnCard(a: GameActionInternal & { type: "burn_card" }, s: GameStateSnapshot): number {
    return super.scoreBurnCard(a, s) + kAdd("second", this.character, "burnCardAdd");
  }
  protected override scoreEndTurn(s: GameStateSnapshot): number {
    return super.scoreEndTurn(s) + kAdd("second", this.character, "endTurnAdd");
  }
  protected override scoreRefresh(a: GameActionInternal & { type: "refresh_metal" }, s: GameStateSnapshot): number {
    return super.scoreRefresh(a, s) + kAdd("second", this.character, "refreshAdd");
  }
  protected override scoreUseBoxing(s: GameStateSnapshot): number {
    return super.scoreUseBoxing(s) + kAdd("second", this.character, "boxingUseAdd");
  }
  protected override scoreUseAtium(a: GameActionInternal & { type: "use_atium" }, s: GameStateSnapshot): number {
    return super.scoreUseAtium(a, s) + kAdd("second", this.character, "atiumAdd");
  }

  // ── Lookahead-shape knobs ── (lookTopK lives above with the value-leaf mode)
  protected override get lookFollowupWeight(): number { return kLook("second", this.character, "lookFollowupWeight") ?? super.lookFollowupWeight; }
  protected override get lookDepth(): number { return kLook("second", this.character, "lookDepth") ?? super.lookDepth; }
  protected override get lookLethalThreshold(): number { return kLook("second", this.character, "lookLethalThreshold") ?? super.lookLethalThreshold; }
  protected override get lookGapGate(): number { return kLook("second", this.character, "lookGapGate") ?? super.lookGapGate; }
}

export function createAnvilBot(
  deck: PlayerDeck,
  game: Game,
  turnOrder: number,
  name: string,
  character: string,
): Player {
  return turnOrder === 0
    ? new AnvilFirstBot(deck, game, turnOrder, name, character)
    : new AnvilSecondBot(deck, game, turnOrder, name, character);
}
