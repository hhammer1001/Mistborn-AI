/**
 * squashV3Bot.ts — experimental going-first variant of SquashV2.
 *
 * Identical to SquashV2 (same evalProfile "squashV2", same ratings, same
 * lookahead) EXCEPT for two targeted, ablatable behavior changes motivated by
 * analysis of Henry's games (where the going-first bot loses winnable
 * mid-length mission races and wastes economy):
 *
 *   flagEconomy — redeem idle boxings across the whole affordable cost ladder
 *     (not just cards costing exactly curMoney+1). Stops banked boxings from
 *     rotting at 50% efficiency when a ladder gap blocks the greedy trigger.
 *
 *   flagRace — race-aware mission closing. When mission is the bot's victory
 *     path, don't apply the opp-lead penalty to advancing the bot's OWN best
 *     mission (refusing to advance because the opp leads is a death spiral when
 *     you're the one who should be racing). Also extend the "about to win" push
 *     to completedMissions >= 1, so the bot commits to closing instead of
 *     diffusing into buys.
 *
 * Toggle the flags as static fields for ablation (see v3head2head.ts).
 */

import type { Game } from "./game";
import { Player } from "./player";
import type { PlayerDeck } from "./deck";
import type { GameStateSnapshot } from "./squashBotEval";
import { SquashV2Bot } from "./squashV2Bot";
import { MISSION_INTRINSIC, SquashV2Config } from "./squashBotEval";
import type { GameActionInternal } from "./types";

export class SquashV3Bot extends SquashV2Bot {
  // ── Tested results (50/matchup × 5 seeds, SquashV3 seat0 vs SquashV2 seat1;
  //    control V2-vs-V2 going first = 71.6%) ──
  //   flagEconomy ........ 68.1%  REJECTED (-3.5pp): forcing boxing redemption
  //                        into marginal buys dilutes the deck / wastes tempo.
  //                        The boxing "hoarding" seen in Henry losses is
  //                        correlation with losing, not a fixable misplay.
  //   flagRaceClose ...... 71.5%  inert (no effect) — the +40 closing push is
  //                        redundant with mission base 70 + existing bonuses.
  //   flagRaceNoPenalty .. 72.5%  KEPT (+0.8pp vs V2-mirror, robust 5/5 seeds;
  //                        biggest in long games). Slightly NEGATIVE vs Zoom
  //                        (-0.6pp) — the opp-lead penalty is overfit to Zoom.
  //                        Net win vs human mission-racers who drag games long.
  static flagEconomy = false; // rejected
  static flagRace = true; // umbrella for the mission-advance override
  static flagRaceNoPenalty = true; // KEEP: skip opp-lead penalty on own mission path
  static flagRaceClose = false; // inert
  static flagRacing = false; // turns-to-win race press (experimental)
  static flagDefense = false; // heal/defender boost under damage-race pressure (experimental)

  // ── Card-play tuning knobs ──
  // Validated (vs V2, 3 seeds, on top of nopen): flareCost 1.0 + burnMetalCost 0
  // = +5-6 games/1000 (~+0.6pp), robust. earlyBurnBonus is CATASTROPHIC
  // (+5 => 541/1000, +10 => 341) — forcing early burns wrecks the engine; left
  // at 0. Defaults below are the validated KEPT config.
  static flagCardPlay = true;
  static flareCost = 1.0; // KEEP (was 1.5): flare slightly more eagerly
  static burnMetalCost = 0.0; // KEEP (was 0.5): make tokens slightly more eagerly
  static earlyBurnBonus = 0; // rejected — do NOT burn more early

  constructor(deck: PlayerDeck, game: Game, turnOrder: number, name = "SquashV3 Bot", character = "Marsh") {
    super(deck, game, turnOrder, name, character);
  }

  // ── Economy: redeem idle boxings across the full affordable ladder ──
  protected override scoreUseBoxing(snap: GameStateSnapshot): number {
    if (!SquashV3Bot.flagEconomy) return super.scoreUseBoxing(snap);

    // Look at every market card the bot could afford by spending money + the
    // boxings it actually holds — not just the one priced exactly curMoney+1.
    // Redeeming a boxing is "free" value if it unlocks an on-strategy buy this
    // turn (boxings carry over but only at 50% when re-banked, so deploying a
    // held token toward a real buy beats hoarding it).
    const buffer = this.dynBuffer(snap);
    const reachable = this.game.market.hand
      .filter((c) => c.cost > snap.curMoney && c.cost <= snap.curMoney + snap.curBoxings)
      .map((c) => this.cardRating(c, snap));
    const best = reachable.length > 0 ? Math.max(...reachable) : 0;
    if (best > buffer) return best * 5;

    // Fall back to the V2 trigger (handles the exact-curMoney+1 case + buffer).
    return super.scoreUseBoxing(snap);
  }

  // ── Race-aware mission closing ──
  protected override scoreMissionAdvance(
    action: GameActionInternal & { type: "advance_mission" },
    snap: GameStateSnapshot,
  ): number {
    if (!SquashV3Bot.flagRace) return super.scoreMissionAdvance(action, snap);

    const mission = action.mission;
    const mSnap = snap.missions.find((m) => m.name === mission.name);
    if (!mSnap) return 50;

    let score = 70;

    const gapToNextTier = mSnap.nextThreshold - mSnap.myRank;
    if (gapToNextTier === 1) score += 18;
    else if (gapToNextTier <= 3) score += 10;

    if (mSnap.myRank >= mSnap.oppRank) score += 8;

    // Opp-lead awareness — but NOT on the bot's own mission path. When the bot
    // is the mission racer (going first, mission victory path), refusing to
    // advance a mission the opp happens to lead is exactly how it loses a race
    // it should win. Only de-prioritize trailing missions when the bot is NOT
    // committed to mission (e.g., damage path picking which mission to dabble).
    const oppLeadAware =
      (snap.profile === "zoom" && snap.turnOrder === 1) ||
      (snap.profile === "squashV2" && snap.turnOrder === 0 && SquashV2Config.oppLeadAwareness);
    const onMissionPath = snap.victoryPath === "mission";
    const skipPenalty = SquashV3Bot.flagRaceNoPenalty && onMissionPath;
    if (oppLeadAware && !skipPenalty) {
      const lead = mSnap.oppRank - mSnap.myRank;
      if (lead >= 4) score -= 12;
      else if (lead >= 2) score -= 5;
    }

    // Closing push: extend the "about to win" bonus from completedMissions===2
    // to >=1. Once the bot has one mission banked and another in reach, commit
    // tempo to finishing rather than diffusing actions into marginal buys.
    if (SquashV3Bot.flagRaceClose && snap.completedMissions >= 1 && mSnap.distanceToComplete <= 3) score += 40;
    if (snap.completedMissions === 2 && mSnap.distanceToComplete <= 3) score += 20;

    // Turns-to-win race press: compare total remaining mission work (lower =
    // closer to winning). Press the gas both when ahead (extend the lead) and
    // when behind-but-late (sprint the best mission before opp finishes).
    if (SquashV3Bot.flagRacing && onMissionPath) {
      const myRemaining = snap.missions.reduce((s, m) => s + m.distanceToComplete, 0);
      const oppRemaining = snap.missions.reduce((s, m) => s + Math.max(0, 12 - m.oppRank), 0);
      const lead = oppRemaining - myRemaining; // >0 = I need fewer points
      if (lead >= 2) score += 8;
      else if (lead <= -4 && snap.turnCount >= 12) score += 12;
      if (myRemaining <= 8) score += 8; // near the finish line
    }
    if (snap.completedMissions >= 2) score += 20;

    score += (MISSION_INTRINSIC[mission.name] ?? 0.5) * 10;

    if (mSnap.iAmBehind) score += 8;
    const oppGap = mSnap.oppRank > 0 ? mSnap.nextThreshold - mSnap.oppRank : 99;
    if (oppGap <= 2 && gapToNextTier <= 3) score += 20;
    if (snap.oppCompletedMissions >= 2) score += 15;

    if (snap.victoryPath === "damage") score *= 0.7;
    if (snap.victoryPath === "mission") {
      let m = 1.2;
      if (snap.profile === "squashV2" && this.character === "Shan") m = SquashV2Config.shanMissionMult;
      score *= m;
    }

    return score;
  }

  // ── Card-play: adjust burn/flare costs via super()+delta (no reimplementation) ──
  protected override scoreFlare(
    action: GameActionInternal & { type: "flare_metal" },
    snap: GameStateSnapshot,
  ): number {
    const base = super.scoreFlare(action, snap);
    return SquashV3Bot.flagCardPlay ? base + (1.5 - SquashV3Bot.flareCost) : base;
  }

  protected override scoreBurnMetal(
    action: GameActionInternal & { type: "burn_metal" },
    snap: GameStateSnapshot,
  ): number {
    const base = super.scoreBurnMetal(action, snap);
    return SquashV3Bot.flagCardPlay ? base + (0.5 - SquashV3Bot.burnMetalCost) : base;
  }

  protected override scoreBurnCard(
    action: GameActionInternal & { type: "burn_card" },
    snap: GameStateSnapshot,
  ): number {
    const base = super.scoreBurnCard(action, snap);
    if (SquashV3Bot.flagCardPlay && SquashV3Bot.earlyBurnBonus && snap.gamePhase === "early") {
      return base + SquashV3Bot.earlyBurnBonus;
    }
    return base;
  }

  // ── Predictive defense: value heal effects more when losing the damage race ──
  // We can't see the opponent's hand, but "I've taken more than I've dealt and
  // my HP is in a danger band" is a usable proxy for being under real pressure.
  protected override scoreUseMetal(
    action: GameActionInternal & { type: "use_metal" },
    snap: GameStateSnapshot,
  ): number {
    let base = super.scoreUseMetal(action, snap);
    if (SquashV3Bot.flagDefense) {
      const card = action.card;
      const nextTier = card.metalUsed + 1;
      const codes = [card.data[3], card.data[5], card.data[7]];
      if (nextTier >= 1 && nextTier <= 3) base += this.healThreatBonus(codes[nextTier - 1], snap);
    }
    return base;
  }

  protected override scoreAllyAbility(
    action: GameActionInternal & { type: "ally_ability_1" | "ally_ability_2" },
    snap: GameStateSnapshot,
    tier: number,
  ): number {
    let base = super.scoreAllyAbility(action, snap, tier);
    if (SquashV3Bot.flagDefense) {
      const ally = action.card as { data?: unknown[] };
      const code = tier === 1 ? ally?.data?.[3] : ally?.data?.[5];
      base += this.healThreatBonus(code, snap);
    }
    return base;
  }

  /** Bonus for a heal effect when under damage-race pressure; 0 otherwise. */
  private healThreatBonus(effectCode: unknown, snap: GameStateSnapshot): number {
    if (typeof effectCode !== "string" || !effectCode.includes("H")) return 0;
    const underPressure = snap.myHealth <= 22 && snap.myHealth < snap.oppHealth;
    if (!underPressure) return 0;
    // Scale by how dire: deeper HP deficit → bigger heal premium.
    return snap.myHealth <= 12 ? 18 : 10;
  }

  // Small accessor so the override can reach the buy buffer the same way the
  // base does (dynamicBuffer is module-private to squashBot.ts).
  private dynBuffer(snap: GameStateSnapshot): number {
    // Mirror base scoreUseBoxing's buffer; recompute via a throwaway use of the
    // base method is awkward, so approximate with the same call the base makes.
    // We reuse cardRating + the base's own buffer by delegating: the base
    // scoreUseBoxing already compares against dynamicBuffer, so for our extra
    // ladder check we compare against a slightly looser buffer (buffer - 0.5)
    // to favor deploying idle boxings.
    return this.buyBuffer(snap) - 0.5;
  }

  // Expose buy buffer; squashBot computes it via module fn dynamicBuffer. We
  // approximate using the same SquashV2 override (buyBufferOverride=5 default).
  private buyBuffer(_snap: GameStateSnapshot): number {
    const o = SquashV2Config.buyBufferOverride[this.character];
    return o && o > 0 ? o : 1.7;
  }
}

export function createSquashV3Bot(
  deck: PlayerDeck,
  game: Game,
  turnOrder: number,
  name: string,
  character: string,
): Player {
  return new SquashV3Bot(deck, game, turnOrder, name, character);
}
