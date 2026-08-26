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
import { dynamicBuffer } from "./squashBotEval";
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

export type RankFn = (actions: GameActionInternal[], game: Game) => { action: GameActionInternal; score: number }[];

/** Greedily play out the rest of the turn (heuristic-best actions, stop when
 * end_actions tops the ranking), then mirror playTurn's close (assignDamage →
 * attack → damage reset) and return the P(win)-scaled value of the boundary
 * state. Mutates `game`; caller restores. */
export function rolloutTurnEndValue(bot: Player, game: Game, rank: RankFn): number {
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
export function finishTurnAndEvaluate(bot: Player, game: Game): number {
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

/** True when the opponent's reply turn can be simulated, i.e. when
 * finishTurnAndEvaluate reaches the postOppTurn=1 boundary the veto was
 * validated on. False against a human (WebPlayer), where every candidate
 * collapses to the own-turn-end phase (see finishTurnAndEvaluate). */
export function oppReplySimulatable(bot: Player, game: Game): boolean {
  return game.players[(bot.turnOrder + 1) % 2] instanceof SquashBot;
}

/** What the veto may do when the opponent's reply can't be simulated — i.e.
 * in every live game, where the opponent is a human:
 *   "full"     — unrestricted (pre-fix; threw away ~1 opening turn in 5)
 *   "keepTurn" — the veto may reorder the turn but may not end it (shipped)
 *   "off"      — no veto at all; play the heuristic
 * "keepTurn" beat both alternatives vs a non-simulatable opponent
 * (63.0/64.3% over two 300-game ranges, vs 62.0/64.0 full and 55.3/57.7 off)
 * and is inert against bots. See BOT_NOTES "The phase-0 veto bug". */
export type Phase0VetoMode = "full" | "keepTurn" | "off";
let phase0VetoMode: Phase0VetoMode = "keepTurn";
export function setPhase0VetoMode(mode: Phase0VetoMode): void { phase0VetoMode = mode; }

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
  extraCandidate: GameActionInternal | null = null,
  allowEnd = true,
): GameActionInternal {
  let candidates = rank(actions, game).slice(0, topK);
  // Without the opponent's reply the model cannot price the tempo given up
  // by stopping early, and it systematically overrates the untouched hand:
  // it rated "end the turn having done nothing" above a full opening turn
  // that advanced a mission, dealt 2 damage and banked a boxing. Every other
  // candidate reaches the same turn-end boundary, so those stay comparable.
  if (!allowEnd) candidates = candidates.filter((c) => c.action.type !== "end_actions");
  if (!candidates.some((c) => c.action === heuristicPick)) {
    candidates.push({ action: heuristicPick, score: 0 });
  }
  if (extraCandidate && !candidates.some((c) => c.action === extraCandidate)) {
    candidates.push({ action: extraCandidate, score: 0 });
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

/** Buy-vs-bank verdict for scoreBuyBoxing. Returns:
 *  "spend" — an above-buffer card is affordable and nothing much better is
 *            within banking reach: banking is wrong (the -1 money round trip
 *            fix, observed live).
 *  "bank"  — a clearly better card sits just beyond reach (affordable with
 *            one more banked turn): banking toward it beats a mediocre buy
 *            (observed live: bot bought Coppercloud@2 and left Pierce@6 on
 *            the table in both games of a twin pair; Henry banked and won).
 *  "base"  — neither signal; fall through to the base heuristic. */
function buyOrBank(game: Game, snap: GameStateSnapshot, character: string, rate: (c: Card) => number): "spend" | "bank" | "base" {
  const buffer = dynamicBuffer(character, snap);
  const reach = snap.curMoney + snap.curBoxings;
  let bestNow = -Infinity;
  let bestTarget = -Infinity;
  for (const c of game.market.hand) {
    const r = rate(c);
    if (c.cost <= reach) bestNow = Math.max(bestNow, r);
    else if (c.cost <= reach + 3) bestTarget = Math.max(bestTarget, r); // one banked turn away
  }
  if (bestTarget > buffer && bestTarget >= bestNow + 2.5) return "bank";
  if (bestNow > buffer) return "spend";
  return "base";
}

// ── Mission-burst solver ──
// Mirror of the lethal solver, for the OTHER win condition. Motivated by
// Henry's twin-seed games (BOT_NOTES case studies 1-2): across 181 games his
// max single-turn mission gain beats the bot's by ~3 points in both seats,
// and burst>=10 turns predict an 86% win rate. Greedy per-action scoring
// cannot assemble multi-source threshold-crossing turns; this searches for
// them explicitly, bounded and budgeted like findLethalAction.

/** Sum of Mi amounts in an effect/amount string pair ("M.Mi", "2.3" -> 3). */
function miIn(effect: string | undefined, amount: string | undefined): number {
  if (!effect) return 0;
  const es = effect.split(".");
  const as_ = (amount ?? "").split(".");
  let mi = 0;
  for (let i = 0; i < es.length; i++) if (es[i] === "Mi") mi += parseInt(as_[i] ?? "0", 10) || 0;
  return mi;
}

/** Optimistic estimate of mission points realizable this turn. */
function missionPotential(bot: Player): number {
  let pts = bot.curMission;
  for (const c of bot.deck.hand) {
    const card = c as Card & { data?: string[]; metalUsed?: number; capacity?: number; burned?: boolean };
    if (!card.data) continue;
    const tierIdx = (card.metalUsed ?? 0);
    if (!card.burned && tierIdx < (card.capacity ?? 0)) {
      pts += miIn(card.data[3 + tierIdx * 2], card.data[4 + tierIdx * 2]);
    }
    pts += miIn(card.data[11], card.data[12]); // burn effect
  }
  for (const a of bot.allies) {
    const ally = a as { data?: string[]; available1?: boolean; available2?: boolean };
    if (ally.data && ally.available1) pts += miIn(ally.data[3], ally.data[4]);
    if (ally.data && ally.available2) pts += miIn(ally.data[5], ally.data[6]);
  }
  if (bot.charAbility1 && bot.training >= 5) pts += miIn(bot.ability1effect, bot.ability1amount);
  return pts;
}

/** Threshold targets worth bursting for: completion always; tier thresholds
 * only when we would be FIRST to them (first-reward bonus). Returns the
 * smallest gap and a scorer for post-chain evaluation. */
function burstTargets(bot: Player, game: Game): { minGap: number; score: (ranksBefore: number[], ranksAfter: number[]) => number } {
  const idx = bot.turnOrder;
  let minGap = Infinity;
  for (let mi = 0; mi < game.missions.length; mi++) {
    const m = game.missions[mi];
    const my = m.playerRanks[idx];
    if (my < 12) minGap = Math.min(minGap, 12 - my);
    for (const t of m.tiers) {
      if (my < t.threshold && Math.max(...m.playerRanks) < t.threshold) {
        minGap = Math.min(minGap, t.threshold - my);
      }
    }
  }
  // Reward-type weights: crossings that pay resources which convert THIS
  // turn (money -> buys, atium, training toward unlocks, draws) are worth
  // chasing even on unstarted missions — Henry's observed line: dump the
  // whole turn's mission output into a fresh mission, collect the money
  // tier, buy the bomb the same turn.
  const fund = fundingsInDeck(bot);
  const rewardWeight = (code: string, amt: number): number => tierRewardWeight(code, amt, fund);
  const score = (before: number[], after: number[]): number => {
    let sc = 0;
    for (let mi = 0; mi < game.missions.length; mi++) {
      const m = game.missions[mi];
      const b = before[mi], a = after[mi];
      if (b < 12 && a >= 12) sc += 100; // completion
      for (const t of m.tiers) {
        if (b < t.threshold && a >= t.threshold) {
          sc += 5 + rewardWeight(t.reward, t.rewardAmount);
          if (t.firstReward && Math.max(...m.playerRanks) < t.threshold) {
            sc += 7 + rewardWeight(t.firstReward, t.firstRewardAmount);
          }
        }
      }
      sc += (a - b); // raw rank gain
    }
    return sc;
  };
  return { minGap, score };
}

/** Search for a burst chain: for each candidate first action, greedily chain
 * Mi-producing actions / mission advances and score threshold crossings.
 * Returns the first action of the best chain that crosses at least one
 * completion or first-reward threshold, else null. Budgeted + capped by the
 * callers (same discipline as findLethalAction). */
export function findMissionBurstAction(
  bot: Player,
  game: Game,
  actions: GameActionInternal[],
  rank: RankFn,
  minScore = 12, // 12 = any first-reward crossing; 100 = completions only
): GameActionInternal | null {
  const { minGap, score } = burstTargets(bot, game);
  if (!isFinite(minGap) || missionPotential(bot) < minGap) return null;

  const idx = bot.turnOrder;
  const ranksNow = game.missions.map((m) => m.playerRanks[idx]);
  const baselineScore = score(ranksNow, ranksNow); // 0 — crossings only count

  const candidates = actions.filter((a) => a.type !== "end_actions" && !a.type.startsWith("buy"));
  if (candidates.length === 0) return null;

  const startTime = Date.now();
  const budgetMs = 50;
  const stateBefore = snapshotGame(game);
  const self = bot as Player & { _simulating?: boolean };
  const wasSim = self._simulating;
  self._simulating = true;

  // Inner greedy: prefer mission advances, then Mi-producing actions, then
  // the heuristic's pick. Uses the rank fn only as a tiebreak source.
  const burstPick = (avail: GameActionInternal[]): GameActionInternal | null => {
    const adv = avail.filter((a) => a.type === "advance_mission");
    if (adv.length > 0) {
      // advance the mission closest to a target threshold
      let best: GameActionInternal | null = null;
      let bestGap = Infinity;
      for (const a of adv) {
        const m = (a as GameActionInternal & { mission: { name: string; playerRanks: number[]; tiers: { threshold: number }[] } }).mission;
        const my = m.playerRanks[idx];
        const gaps = [12 - my, ...m.tiers.map((t) => t.threshold - my).filter((g) => g > 0)];
        const g = Math.min(...gaps.filter((x) => x > 0));
        if (g < bestGap) { bestGap = g; best = a; }
      }
      return best;
    }
    const ranked = rank(avail.filter((a) => a.type !== "end_actions" && !a.type.startsWith("buy")), game);
    return ranked[0]?.action ?? null;
  };

  let bestFirst: GameActionInternal | null = null;
  let bestScore = baselineScore;
  try {
    for (const first of candidates) {
      if (Date.now() - startTime > budgetMs) break;
      try {
        bot.performAction(first, game);
        game.drainPendingKills();
        if (game.winner === bot) { restoreGame(game, stateBefore); return first; }
        if (!game.winner) {
          for (let depth = 0; depth < 14; depth++) {
            if (Date.now() - startTime > budgetMs) break;
            const avail = bot.availableActions(game);
            const pick = burstPick(avail);
            if (!pick) break;
            try { bot.performAction(pick, game); game.drainPendingKills(); } catch { break; }
            if (game.winner === bot) { restoreGame(game, stateBefore); return first; }
            if (game.winner) break;
          }
        }
        if (!game.winner) {
          const after = game.missions.map((m) => m.playerRanks[idx]);
          const sc = score(ranksNow, after);
          // Require a real crossing (completion=100 or first-reward=12), not
          // just rank accumulation the greedy heuristic would find anyway.
          const crossed = sc - after.reduce((s, a, i) => s + (a - ranksNow[i]), 0) >= minScore;
          if (crossed && sc > bestScore) { bestScore = sc; bestFirst = first; }
        }
      } catch {
        // skip failed branches
      } finally {
        restoreGame(game, stateBefore);
      }
    }
  } finally {
    self._simulating = wasSim;
  }
  return bestFirst;
}

// ── Deck-thinning context (Henry finding: the bot NEVER eliminated an own
// card in 210+ recorded games — 758 "eliminate" log lines were all the
// deck-neutral buy_eliminate. Henry trashes ~9/game and wins 79% of games
// where he reaches Canton's first E tier; the bot averages rank 4.4 there.)

const SELF_TRASHERS = new Set(["Con", "Deceive", "Dominate", "Pacify", "Soother", "Subdue"]);

function fundingsInDeck(bot: Player): number {
  let n = 0;
  for (const pile of [bot.deck.hand, bot.deck.discard, bot.deck.cards]) {
    for (const c of pile) if (c.constructor.name === "Funding") n++;
  }
  return n;
}

/** Bonus for firing an effect that ELIMINATES while dead Fundings remain:
 * each removal permanently densifies every future draw. Tunable. */
export const ThinningConfig = { effectBoost: 8, buyBoost: 2.5, burstEWeight: 2.5, missionRewardScale: 1.5, commitScale: 1.0, fuelGuard: 0 };

function eBoost(bot: Player, effectStr: string | undefined): number {
  if (!effectStr || !effectStr.split(".").includes("E")) return 0;
  const f = fundingsInDeck(bot);
  return f >= 2 ? ThinningConfig.effectBoost : f >= 1 ? ThinningConfig.effectBoost / 2 : 0;
}

/** Penalty for burn_card on a card whose USE ability eliminates: burning the
 * trasher as fuel forfeits its E for this whole deck cycle. Greedy action
 * order made the use_metal eBoost unreachable — burn Con (+1 mission) fires
 * before a brass token exists, so "use Con" is never a legal candidate.
 * (Twin pair seed 3991251187: the bot burned Con 4x/game, 0 elims, final
 * hands were 4 Fundings + Training; Henry trashed 5/6 Fundings and won both
 * seats.) The guard flips the ordering: burn the plain same-metal card
 * first, then use the trasher.  Scaled like eBoost, off when nothing dead
 * remains to trash.
 *
 * DEFAULT 0 after a paired-seed A/B (4200 pairs, 2 ranges, vs V3 seat 1):
 * 143 winner flips split 67 to-win / 76 to-loss (sign p=0.50, -0.21pp
 * pooled). Vs bots the mission tempo given up cancels the density gained —
 * the value veto had learned that correctly, and overriding it was
 * unjustified. Knob kept for a live A/B vs Henry, where his own thinning
 * demonstrably wins. */
function trasherFuelGuard(bot: Player, card: { data?: string[] }): number {
  // NOTE: computed directly, NOT as a ratio of eBoost — dividing by
  // effectBoost NaN/Inf-poisoned every score when effectBoost was 0 (found
  // when the CEM search's all-zero anchor went 0-for-420 seven times).
  if (ThinningConfig.fuelGuard === 0) return 0;
  const eff = card.data?.[3];
  if (!eff || !eff.split(".").includes("E")) return 0;
  const f = fundingsInDeck(bot);
  return -(f >= 2 ? ThinningConfig.fuelGuard : f >= 1 ? ThinningConfig.fuelGuard / 2 : 0);
}

/** Value of a mission tier's reward contents, funding-aware for E. Shared by
 * the burst solver's target scoring and Anvil's mission-advance scoring —
 * the heuristic scorer historically ignored what tiers PAY, which is how
 * the bot ended up climbing Skaa's refresh tiers over Canton's eliminate
 * tiers (Henry's read: the E mission was "certainly the difference"). */
export function tierRewardWeight(code: string, amt: number, fundings: number): number {
  if (!code) return 0;
  let w = 0;
  const as_ = String(amt).split(".");
  code.split(".").forEach((c, i) => {
    const a = parseInt(as_[i] ?? as_[0] ?? "1", 10) || 1;
    if (c === "M") w += 2.5 * a;
    else if (c === "A") w += 3 * a;
    else if (c === "T") w += 2 * a;
    else if (c === "C") w += 2 * a;
    else if (c === "E") w += (fundings >= 2 ? ThinningConfig.burstEWeight : 1) * a;
    else if (c === "Pc" || c === "Pd" || c === "Pm") w += 8;
    else w += a;
  });
  return w;
}

/** Anvil mission-selection bonus: value the nearest uncrossed tier's reward
 * contents, discounted by distance. Divergence runs 1+3: mission SELECTION
 * was the largest systematic Henry-vs-bot gap. Tunable via ThinningConfig. */
export function missionRewardBonus(bot: Player, game: Game, missionName: string): number {
  const m = game.missions.find((mi) => mi.name === missionName);
  if (!m) return 0;
  const my = m.playerRanks[bot.turnOrder];
  const fund = fundingsInDeck(bot);
  const top = Math.max(...m.playerRanks);
  for (const t of m.tiers) {
    if (my < t.threshold) {
      let w = tierRewardWeight(t.reward, t.rewardAmount, fund);
      if (top < t.threshold) w += tierRewardWeight(t.firstReward, t.firstRewardAmount, fund) * 0.7;
      return (ThinningConfig.missionRewardScale * w) / Math.max(1, t.threshold - my);
    }
  }
  return 0;
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

  // Mission-burst solver: KILLED for this class. Both integration shapes
  // regressed vs Zoom @2.5B without a value arbiter (override-mode -5.5pp,
  // and buy-or-bank banking -3.9pp — the BOT_NOTES "save-for-6-cost"
  // rejection replicating). The live app bot is always AnvilSecondBot
  // (index dispatch), which carries both features under veto arbitration.

  override selectAction(actions: GameActionInternal[], game: Game): GameActionInternal {
    const simulating = (this as Player & { _simulating?: boolean })._simulating;
    const margin = AnvilFirstBot.valueVetoMargin;
    const phase0 = !oppReplySimulatable(this, game);
    if (margin <= 0 || !valueModelAvailable() || (phase0 && phase0VetoMode === "off")
        || this.turnOrder !== 0 || actions.length < 2 || simulating) {
      return super.selectAction(actions, game);
    }
    const heuristicPick = super.selectAction(actions, game);
    return vetoSelect(this, game, actions, heuristicPick, AnvilFirstBot.valueLeafTopK, margin, this.rankFn,
      null, !phase0 || phase0VetoMode === "full");
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
  protected override scoreBuyBoxing(snap: GameStateSnapshot): number {
    // Spend-guard only: the "bank toward a better card" verdict regressed
    // this class -3.9pp vs Zoom (no value arbiter here); AnvilSecondBot
    // keeps the full buy-or-bank under veto arbitration.
    if (buyOrBank(this.game, snap, this.character, (c) => this.cardRating(c, snap)) === "spend") return -6;
    return super.scoreBuyBoxing(snap);
  }
  protected override followupEligible(a: GameActionInternal): boolean {
    return a.type !== "use_boxing" && a.type !== "buy_boxing";
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

  /** Mission-burst solver (see findMissionBurstAction): burst chains join
   * the veto's candidate set; the value model arbitrates grind vs burst.
   * Bench-neutral vs bots (39.4/38.4 on reference ranges), motivated by the
   * measured ~3-point burst gap vs Henry. Default ON. */
  static missionBurstEnabled = true;
  private burstCallsTurn = -1;
  private burstCallsThisTurn = 0;

  override selectAction(actions: GameActionInternal[], game: Game): GameActionInternal {
    const margin = AnvilSecondBot.valueVetoMargin;
    const simulating = (this as Player & { _simulating?: boolean })._simulating;
    let burst: GameActionInternal | null = null;
    if (AnvilSecondBot.missionBurstEnabled && !simulating && actions.length >= 2) {
      if (this.burstCallsTurn !== game.turncount) { this.burstCallsTurn = game.turncount; this.burstCallsThisTurn = 0; }
      if (this.burstCallsThisTurn < 6) {
        this.burstCallsThisTurn++;
        burst = findMissionBurstAction(this, game, actions, this.rankFn);
      }
    }
    const phase0 = !oppReplySimulatable(this, game);
    if (!this.valueLeafOn || margin <= 0 || !this.seatGateOk || (phase0 && phase0VetoMode === "off")
        || actions.length < 2 || simulating) {
      // No veto to arbitrate — take completion-level bursts only.
      if (burst) {
        const strict = findMissionBurstAction(this, game, actions, this.rankFn, 100);
        if (strict) return strict;
      }
      return super.selectAction(actions, game);
    }
    // Heuristic decision first (value hooks stay heuristic in veto mode);
    // the burst chain's first action joins the veto's candidate set — the
    // value model arbitrates between grind and burst.
    const heuristicPick = super.selectAction(actions, game);
    return vetoSelect(this, game, actions, heuristicPick, AnvilSecondBot.valueLeafTopK, margin, this.rankFn, burst,
      !phase0 || phase0VetoMode === "full");
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
    let r = super.cardRating(card, snap) + kDelta("second", this.character, card.name);
    // Self-trashers gain value while dead Fundings dilute the deck.
    if (SELF_TRASHERS.has(card.name) && fundingsInDeck(this) >= 3) r += ThinningConfig.buyBoost;
    return r;
  }

  // ── Heuristic-assumption knobs ──
  protected override scoreMissionAdvance(a: GameActionInternal & { type: "advance_mission" }, s: GameStateSnapshot): number {
    // Commitment gradient: invested progress raises the priority of
    // FINISHING. Henry's Canton histogram is bimodal (0 or 12); the bot's
    // smeared across 1-6 — after a tier crossing the proximity bonus
    // vanishes and "closest tier elsewhere" wins, so it dribbles and
    // wanders. It stalls from AHEAD (23 vs 19), so this is self-inflicted
    // dithering, not opp pressure. Echoes the oldest doctrine lesson:
    // commitment > accuracy.
    const commit = ThinningConfig.commitScale * Math.min(a.mission.playerRanks[this.turnOrder], 11);
    return super.scoreMissionAdvance(a, s) * kMult("second", this.character, "missionMult") + kAdd("second", this.character, "missionAdd")
      + missionRewardBonus(this, this.game, a.mission.name) + commit;
  }
  protected override scoreUseMetal(a: GameActionInternal & { type: "use_metal" }, s: GameStateSnapshot): number {
    const nextTier = a.card.metalUsed + 1;
    const eff = [a.card.data[3], a.card.data[5], a.card.data[7]][nextTier - 1];
    return super.scoreUseMetal(a, s) + kAdd("second", this.character, "useMetalAdd") + eBoost(this, eff);
  }
  protected override scoreAllyAbility(a: GameActionInternal & { type: "ally_ability_1" | "ally_ability_2" }, s: GameStateSnapshot, tier: number): number {
    const ally = a.card as { data?: string[] };
    const eff = tier === 1 ? ally.data?.[3] : ally.data?.[5];
    return super.scoreAllyAbility(a, s, tier) + kAdd("second", this.character, "allyAdd") + eBoost(this, eff);
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
    return super.scoreBurnCard(a, s) + kAdd("second", this.character, "burnCardAdd") + trasherFuelGuard(this, a.card);
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
  /** Era toggle for replay fidelity: the "bank" verdict shipped with the
   * burst solver; pre-ship recordings replay with it off. */
  static bankVerdictEnabled = true;
  protected override scoreBuyBoxing(snap: GameStateSnapshot): number {
    const verdict = buyOrBank(this.game, snap, this.character, (c) => this.cardRating(c, snap));
    if (verdict === "bank" && AnvilSecondBot.bankVerdictEnabled) return 4;
    if (verdict === "spend") return -6; // no banking while a good buy is affordable
    return super.scoreBuyBoxing(snap);
  }
  protected override followupEligible(a: GameActionInternal): boolean {
    return a.type !== "use_boxing" && a.type !== "buy_boxing";
  }
  protected override scoreUseAtium(a: GameActionInternal & { type: "use_atium" }, s: GameStateSnapshot): number {
    return super.scoreUseAtium(a, s) + kAdd("second", this.character, "atiumAdd");
  }
  /** Divergence run 3: in games where Henry advanced a mission while the bot
   * wanted buy_eliminate, Henry won 96% (n=74) — the buy-eliminate appetite
   * is a self-play-bred bias. Damp it; the veto still arbitrates. */
  static buyElimDamp = 0.75;
  protected override scoreBuyEliminate(a: GameActionInternal & { type: "buy_eliminate" }, s: GameStateSnapshot): number {
    return super.scoreBuyEliminate(a, s) * AnvilSecondBot.buyElimDamp;
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
