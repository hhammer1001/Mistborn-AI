/**
 * SquashBot — State-aware AI using first-principles analytical card ratings
 * and action scoring instead of a rigid priority waterfall.
 */

import { Player } from "./player";
import { Card, Action, Ally, Funding } from "./card";
import { PlayerDeck } from "./deck";
import type { Game } from "./game";
import type { GameActionInternal } from "./types";
import {
  buildSnapshot,
  estimateEffectValue,
  dynamicCardRating,
  metalUnlockValue,
  burnSynergyValue,
  dynamicBuffer,
  ANALYTICAL_RATINGS,
  MISSION_INTRINSIC,
  type GameStateSnapshot,
} from "./squashBotEval";

export class SquashBot extends Player {
  private seekCount = 0;
  private actionCount = 0;
  // Exploration rate for self-play data collection — 0 for normal play.
  // When > 0, bot occasionally picks a near-best action instead of the best.
  static explorationRate = 0;

  constructor(deck: PlayerDeck, game: Game, turnOrder: number, name = "Squash Bot", character = "Marsh") {
    super(deck, game, turnOrder, name, character);
  }

  // ── Card evaluation ──

  private cardRating(card: Card, snap: GameStateSnapshot): number {
    return dynamicCardRating(card.name, this.character, snap);
  }

  private staticRating(card: Card): number {
    return ANALYTICAL_RATINGS[this.character]?.[card.name] ?? 0;
  }

  // Guard against rare engine bug where undefined enters a deck pile
  override playTurn(game: Game) {
    this.deck.hand = this.deck.hand.filter((c) => c != null);
    this.deck.discard = this.deck.discard.filter((c) => c != null);
    this.deck.cards = this.deck.cards.filter((c) => c != null);
    super.playTurn(game);
  }

  // ── Action selection: score everything, pick the best ──

  override selectAction(actions: GameActionInternal[], game: Game): GameActionInternal {
    // Safety: prevent infinite action loops
    this.actionCount++;
    if (this.actionCount > 200) {
      this.actionCount = 0;
      return actions.find((a) => a.type === "end_actions")!;
    }

    const snap = buildSnapshot(this, game);

    // Score all actions
    const scored = actions.map((a) => ({ action: a, score: this.scoreAction(a, snap, game) }));
    scored.sort((a, b) => b.score - a.score);

    let picked = scored[0].action;

    // Epsilon-greedy exploration (only during self-play data collection)
    if (SquashBot.explorationRate > 0 && scored.length > 1 && Math.random() < SquashBot.explorationRate) {
      // Pick a random action from the top-5 (weighted toward the best)
      const topN = Math.min(5, scored.length);
      const idx = Math.floor(Math.random() * topN);
      picked = scored[idx].action;
    }

    if (picked.type === "end_actions") {
      this.actionCount = 0;
    }

    return picked;
  }

  private scoreAction(action: GameActionInternal, snap: GameStateSnapshot, _game: Game): number {
    switch (action.type) {
      case "end_actions": return this.scoreEndTurn(snap);
      case "advance_mission": return this.scoreMissionAdvance(action, snap);
      case "use_metal": return this.scoreUseMetal(action, snap);
      case "burn_card": return this.scoreBurnCard(action, snap);
      case "burn_metal": return this.scoreBurnMetal(action, snap);
      case "flare_metal": return this.scoreFlare(action, snap);
      case "refresh_metal": return this.scoreRefresh(action, snap);
      case "ally_ability_1": return this.scoreAllyAbility(action, snap, 1);
      case "ally_ability_2": return this.scoreAllyAbility(action, snap, 2);
      case "char_ability_1": return this.scoreCharAbility1(snap);
      case "char_ability_3": return this.scoreCharAbility3(snap);
      case "buy": return this.scoreBuy(action, snap);
      case "buy_eliminate": return this.scoreBuyEliminate(action, snap);
      case "buy_with_boxings": return this.scoreBuyBoxings(action, snap);
      case "buy_elim_boxings": return this.scoreBuyElimBoxings(action, snap);
      case "use_atium": return this.scoreUseAtium(action, snap);
      case "buy_boxing": return this.scoreBuyBoxing(snap);
      case "use_boxing": return this.scoreUseBoxing(snap);
    }
  }

  // ── Individual scoring functions ──

  private scoreEndTurn(_snap: GameStateSnapshot): number {
    return 0; // Baseline — everything else must beat this
  }

  private scoreMissionAdvance(
    action: GameActionInternal & { type: "advance_mission" },
    snap: GameStateSnapshot,
  ): number {
    const mission = action.mission;
    const mSnap = snap.missions.find((m) => m.name === mission.name);
    if (!mSnap) return 50;

    let score = 70; // High base — missions are the primary win condition

    // Tier proximity bonus (capped to avoid over-focusing one mission)
    const gapToNextTier = mSnap.nextThreshold - mSnap.myRank;
    if (gapToNextTier === 1) score += 18;
    else if (gapToNextTier <= 3) score += 10;

    // First-to-tier bonus (first player to reach a tier gets bonus rewards)
    if (mSnap.myRank >= mSnap.oppRank) score += 8;

    // Mission victory proximity — about to win the game!
    if (snap.completedMissions === 2 && mSnap.distanceToComplete <= 3) {
      score += 60;
    }
    if (snap.completedMissions === 2) score += 20;

    // Mild bonus for starting an unprogressed mission.
    if (mSnap.myRank === 0) {
      score += 10;
    }

    // Mission intrinsic quality
    score += (MISSION_INTRINSIC[mission.name] ?? 0.5) * 10;

    // Race urgency: if opponent is close to a tier too
    if (mSnap.iAmBehind) score += 8;
    const oppGap = mSnap.oppRank > 0 ? mSnap.nextThreshold - mSnap.oppRank : 99;
    if (oppGap <= 2 && gapToNextTier <= 3) score += 20;

    // Counter opponent near-win
    if (snap.oppCompletedMissions >= 2) score += 15;

    // Victory path multiplier
    if (snap.victoryPath === "damage") score *= 0.7;
    if (snap.victoryPath === "mission") score *= 1.2;

    return score;
  }

  private scoreUseMetal(
    action: GameActionInternal & { type: "use_metal" },
    snap: GameStateSnapshot,
  ): number {
    const card = action.card;
    const nextTier = card.metalUsed + 1;
    const effects: [string, string][] = [
      [card.data[3], card.data[4]],
      [card.data[5], card.data[6]],
      [card.data[7], card.data[8]],
    ];

    if (nextTier >= 1 && nextTier <= 3 && effects[nextTier - 1][0]) {
      const effectVal = estimateEffectValue(effects[nextTier - 1][0], effects[nextTier - 1][1], snap);
      return 30 + effectVal;
    }
    return 30;
  }

  private scoreBurnCard(
    action: GameActionInternal & { type: "burn_card" },
    snap: GameStateSnapshot,
  ): number {
    const card = action.card;

    // Opportunity cost: we lose this card's ability for the turn.
    // Even if metal isn't available yet, we could get it via burn_metal token.
    let opportunityCost = 0;
    if (card.metalUsed < card.capacity) {
      const nextTier = card.metalUsed + 1;
      const effects: [string, string][] = [
        [card.data[3], card.data[4]],
        [card.data[5], card.data[6]],
        [card.data[7], card.data[8]],
      ];
      if (nextTier >= 1 && nextTier <= 3 && effects[nextTier - 1][0]) {
        const tierVal = estimateEffectValue(effects[nextTier - 1][0], effects[nextTier - 1][1], snap);
        if (this.metalAvailable[card.metal] > 0) {
          opportunityCost = tierVal;
        } else {
          opportunityCost = tierVal * 0.6;
        }
      }
    }

    // Burn effect value (some cards give effects when burned)
    const burnEffectVal = card.data[11]
      ? estimateEffectValue(card.data[11], card.data[12], snap)
      : 0;

    // What does the generated metal unlock for OTHER cards?
    // Exclude this card — it can't be both the fuel and the target
    const metalVal = metalUnlockValue(action.metalIndex, this, snap, card);

    // Synergy: does burning this card enable a better card in hand?
    const synergyVal = burnSynergyValue(card, snap);

    return metalVal + burnEffectVal + synergyVal * 0.5 - opportunityCost;
  }

  private scoreBurnMetal(
    action: GameActionInternal & { type: "burn_metal" },
    snap: GameStateSnapshot,
  ): number {
    const metalVal = metalUnlockValue(action.metalIndex, this, snap);
    // Burn slots are limited (usually 1-3) but tokens reset at end of turn.
    // Cost is small — just using a scarce per-turn resource.
    const burnSlotCost = 0.5;
    return metalVal - burnSlotCost;
  }

  private scoreFlare(
    action: GameActionInternal & { type: "flare_metal" },
    snap: GameStateSnapshot,
  ): number {
    const metalVal = metalUnlockValue(action.metalIndex, this, snap);
    // Flare doesn't use a burn slot, but the token becomes "spent" (needs refresh later).
    // Slightly higher long-term cost than burning.
    return metalVal - 1.5;
  }

  private scoreRefresh(
    action: GameActionInternal & { type: "refresh_metal" },
    snap: GameStateSnapshot,
  ): number {
    // Refreshing consumes the card (it becomes burned/unusable), but frees a metal token.
    // Cost: losing this card's activation for the turn.
    let cardCost = 0;
    if (this.metalAvailable[action.card.metal] > 0 && action.card.metalUsed < action.card.capacity) {
      cardCost = 2; // small cost since card could have been activated
    }
    const metalVal = metalUnlockValue(action.metalIndex, this, snap);
    return 5 + metalVal - cardCost;
  }

  private scoreAllyAbility(
    action: GameActionInternal & { type: "ally_ability_1" | "ally_ability_2" },
    snap: GameStateSnapshot,
    tier: number,
  ): number {
    const ally = action.card as Ally;
    const effectStr = tier === 1 ? ally.data[3] : ally.data[5];
    const amountStr = tier === 1 ? ally.data[4] : ally.data[6];

    if (!effectStr) return 0;
    const effectVal = estimateEffectValue(effectStr, amountStr, snap);
    return 40 + effectVal;
  }

  private scoreCharAbility1(snap: GameStateSnapshot): number {
    const effectVal = estimateEffectValue(this.ability1effect, this.ability1amount, snap);
    return 35 + effectVal;
  }

  private scoreCharAbility3(snap: GameStateSnapshot): number {
    const effectVal = estimateEffectValue("D.Mi", "3.3", snap);
    return 35 + effectVal;
  }

  private scoreBuy(
    action: GameActionInternal & { type: "buy" },
    snap: GameStateSnapshot,
  ): number {
    const rating = this.cardRating(action.card, snap);
    const buffer = dynamicBuffer(this.character, snap);

    if (rating < buffer) return -10;

    const phaseMultiplier = snap.gamePhase === "late" ? 0.3 : 1.0;

    // For allies, boost score — they're recurring value
    const allyBonus = action.card instanceof Ally ? 5 : 0;

    // Deck size penalty — every card added dilutes future draws
    const deckPenalty = Math.max(0, (snap.deckSize - 10) * 2.5);

    return rating * 2 * phaseMultiplier + allyBonus - deckPenalty;
  }

  private scoreBuyEliminate(
    action: GameActionInternal & { type: "buy_eliminate" },
    snap: GameStateSnapshot,
  ): number {
    // Buy+eliminate: pay the cost, use the card's ability1 effect, card goes to
    // market discard (NOT your deck). Effect without deck dilution.
    // Available once per turn (charAbility2) at training >= 8.
    const card = action.card;
    const ab1Val = card instanceof Action
      ? estimateEffectValue(card.data[3], card.data[4], snap)
      : (card instanceof Ally ? estimateEffectValue(card.data[3], card.data[4], snap) : 0);

    const eliminateBonus = 5 + Math.max(0, (snap.deckSize - 10) * 0.8);
    const costPenalty = card.cost * 0.5;

    return ab1Val * 1.3 + eliminateBonus - costPenalty;
  }

  private scoreBuyBoxings(
    action: GameActionInternal & { type: "buy_with_boxings" },
    snap: GameStateSnapshot,
  ): number {
    const baseScore = this.scoreBuy(
      { ...action, type: "buy" } as GameActionInternal & { type: "buy" },
      snap,
    );
    return baseScore * 0.85; // boxings have opportunity cost
  }

  private scoreBuyElimBoxings(
    action: GameActionInternal & { type: "buy_elim_boxings" },
    snap: GameStateSnapshot,
  ): number {
    const baseScore = this.scoreBuyEliminate(
      { ...action, type: "buy_eliminate" } as GameActionInternal & { type: "buy_eliminate" },
      snap,
    );
    return baseScore * 0.85;
  }

  private scoreUseAtium(
    action: GameActionInternal & { type: "use_atium" },
    snap: GameStateSnapshot,
  ): number {
    return metalUnlockValue(action.metalIndex, this, snap) - 2;
  }

  private scoreBuyBoxing(snap: GameStateSnapshot): number {
    // Convert 2 money → 1 boxing (savings for future turns)
    if (snap.curMoney % 2 === 1) return -5; // don't waste an odd money
    if (snap.curMoney >= 4) return 1; // save excess
    return -5;
  }

  private scoreUseBoxing(snap: GameStateSnapshot): number {
    // Convert 1 boxing → 1 money
    // Worth it if the extra money enables buying something good
    const bestBuyable = this.game.market.hand
      .filter((c) => c.cost <= snap.curMoney + 1 && c.cost > snap.curMoney)
      .map((c) => this.cardRating(c, snap));
    const buffer = dynamicBuffer(this.character, snap);
    const bestRating = bestBuyable.length > 0 ? Math.max(...bestBuyable) : 0;

    if (bestRating > buffer) return bestRating * 5;
    return -3;
  }

  // ── Decision overrides ──

  override assignDamageIn(targets: Ally[]): number {
    if (targets.length === 0) return -1;

    // Priority: kill defenders first, then highest ability-value allies
    const snap = buildSnapshot(this, this.game);
    const scored = targets.map((ally, i) => {
      let score = 0;
      // Defenders are high priority to remove
      if (ally.defender) score += 10;
      // Allies with abilities are more valuable (to opponent)
      if (ally.data[3]) {
        score += estimateEffectValue(ally.data[3], ally.data[4], snap);
      }
      if (ally.data[5]) {
        score += estimateEffectValue(ally.data[5], ally.data[6], snap);
      }
      // On-play bonuses
      if (ally.name === "Noble") score += 3;
      if (ally.name === "Crewleader") score += 8;
      if (ally.name === "Smoker") score += 2;
      return { i, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Only kill if the target has meaningful value
    if (scored[0].score > 1) return scored[0].i;
    return scored[0].i; // always kill if we can — damage is already committed
  }

  override senseCheckIn(_card: Action): boolean {
    return true; // always use sense to block opponent
  }

  override killEnemyAllyIn(allies: Ally[]): number {
    if (allies.length === 0) return -1;

    // Kill defenders first, then highest-ability, then highest-health
    const snap = buildSnapshot(this, this.game);
    const scored = allies.map((ally, i) => {
      let score = 0;
      if (ally.defender) score += 10;
      if (ally.data[3]) score += estimateEffectValue(ally.data[3], ally.data[4], snap);
      if (ally.data[5]) score += estimateEffectValue(ally.data[5], ally.data[6], snap);
      if (ally.name === "Crewleader") score += 8;
      if (ally.name === "Noble") score += 3;
      if (ally.name === "Smoker") score += 2;
      score += ally.health * 0.5; // tiebreak by health
      return { i, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].i;
  }

  override cloudAlly(_card: Card, _ally: Ally): boolean {
    // Protect high-value allies (Crewleader, Noble, high-ability)
    const allyRating = this.staticRating(_ally);
    return allyRating > 1.5;
  }

  override eliminateIn(): number {
    const h = this.deck.hand.length;
    const d = this.deck.discard.length;
    const c = this.deck.cards.length;
    if (d + h + c < 6) return -1;

    const snap = buildSnapshot(this, this.game);

    // Prioritize eliminating Funding
    for (let i = 0; i < this.deck.hand.length; i++) {
      if (this.deck.hand[i] instanceof Funding) return i;
    }
    for (let i = 0; i < this.deck.discard.length; i++) {
      if (this.deck.discard[i] instanceof Funding) return i + h;
    }

    // Eliminate lowest dynamicRating card below buffer.
    // Allies eligible only when deck is bloated (>=12 cards) — weak allies
    // cycle uselessly through hand→discard→deck, so remove them when we can
    // afford to without thinning the engine.
    const allCards = [...this.deck.hand, ...this.deck.discard];
    const buffer = dynamicBuffer(this.character, snap);
    const deckBloated = (this.deck.hand.length + this.deck.discard.length + this.deck.cards.length) >= 12;
    const candidates = allCards
      .map((card, idx) => ({ idx, card, score: this.cardRating(card, snap) }))
      .filter((c) => c.score < buffer && (deckBloated || !(c.card instanceof Ally)));

    if (candidates.length === 0) return -1;
    const worst = candidates.reduce((a, b) => (a.score < b.score ? a : b));
    return worst.idx;
  }

  override pullIn(): number {
    const snap = buildSnapshot(this, this.game);
    const sorted = this.deck.discard
      .map((c, i) => ({ i, score: this.cardRating(c, snap) }))
      .sort((a, b) => b.score - a.score);

    if (sorted.length > 0 && sorted[0].score > 0.5) return sorted[0].i;
    return -1;
  }

  override subdueIn(choices: Card[]): number {
    const snap = buildSnapshot(this, this.game);
    const sorted = choices
      .map((c, i) => ({ i, score: this.cardRating(c, snap) }))
      .sort((a, b) => b.score - a.score);

    if (sorted.length > 0 && sorted[0].score > 0.5) return sorted[0].i;
    return -1;
  }

  override soarIn(choices: Card[]): number {
    const snap = buildSnapshot(this, this.game);
    const sorted = choices
      .map((c, i) => ({ i, score: this.cardRating(c, snap) }))
      .sort((a, b) => b.score - a.score);

    if (sorted.length > 0 && sorted[0].score > 0.5) return sorted[0].i;
    return -1;
  }

  override confrontationIn(choices: Action[]): number {
    const snap = buildSnapshot(this, this.game);
    const sorted = choices
      .map((c, i) => ({ i, score: estimateEffectValue(c.data[3], c.data[4], snap) }))
      .sort((a, b) => b.score - a.score);

    return sorted.length > 0 ? sorted[0].i : -1;
  }

  override informantIn(card: Card): boolean {
    // Eliminate top of deck if it's low value
    const snap = buildSnapshot(this, this.game);
    return this.cardRating(card, snap) < dynamicBuffer(this.character, snap);
  }

  override keeperIn(_choices: Card[]): number {
    return -1; // Don't set aside cards (conservative)
  }

  override chooseIn(options: string[]): number {
    // Evaluate each option pair with estimateEffectValue
    const snap = buildSnapshot(this, this.game);
    let bestIdx = 0;
    let bestVal = -Infinity;

    for (let i = 0; i < options.length - 1; i += 2) {
      const val = estimateEffectValue(options[i], options[i + 1], snap);
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i >> 1;
      }
    }
    return bestIdx;
  }

  override refreshIn(): number {
    // Refresh the most valuable burned/flared token
    const snap = buildSnapshot(this, this.game);
    let bestIdx = 0;
    let bestVal = -Infinity;

    for (let i = 0; i < this.metalTokens.length; i++) {
      if (this.metalTokens[i] === 2 || this.metalTokens[i] === 4) {
        const val = metalUnlockValue(i, this, snap);
        if (val > bestVal) {
          bestVal = val;
          bestIdx = i;
        }
      }
    }

    // Fallback: pick any refreshable, else random
    if (bestVal <= 0) {
      for (let i = 0; i < this.metalTokens.length; i++) {
        if (this.metalTokens[i] === 2 || this.metalTokens[i] === 4) return i;
      }
      return Math.floor(Math.random() * 8);
    }

    return bestIdx;
  }

  override pushIn(): number {
    // Push the highest-rated market card (deny it from opponent)
    const snap = buildSnapshot(this, this.game);
    const choices = this.game.market.hand;
    const sorted = choices
      .map((c, i) => ({ i, score: this.cardRating(c, snap) }))
      .sort((a, b) => b.score - a.score);

    return sorted.length > 0 ? sorted[0].i : -1;
  }

  override riotIn(riotable: Ally[]): Ally {
    // Pick the ally whose ability produces the highest value
    const snap = buildSnapshot(this, this.game);
    const scored = riotable.map((ally) => ({
      ally,
      score: estimateEffectValue(ally.data[3], ally.data[4], snap),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].ally;
  }

  override seekIn(twice: boolean, _seeker: boolean, choices: Action[]): [number, number] {
    this.seekCount += 1;
    if (this.seekCount > 100) return [-1, -1];

    const snap = buildSnapshot(this, this.game);
    const sorted = choices
      .map((c, i) => ({ i, score: estimateEffectValue(c.data[3], c.data[4], snap) }))
      .sort((a, b) => b.score - a.score);

    if (sorted.length === 0) return [-1, -1];
    if (sorted.length === 1 || !twice) {
      return [sorted[0].i, -1];
    }
    return [sorted[0].i, sorted[1].i];
  }

  override cloudP(card: Action): boolean {
    const reduction = parseInt(card.data[10], 10) || 0;
    // Use cloud if it would save from death or significant damage
    if (this.curHealth <= 0) return true;
    if (this.curHealth <= 15) return true;
    if (reduction >= 4) return true;
    return card.name === "Coppercloud"; // cheap to use
  }
}

/** Factory function for creating Squash bots */
export function createSquashBot(
  deck: PlayerDeck,
  game: Game,
  turnOrder: number,
  name: string,
  character: string,
): Player {
  return new SquashBot(deck, game, turnOrder, name, character);
}
