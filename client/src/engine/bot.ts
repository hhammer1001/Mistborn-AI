import { Player } from "./player";
import { Card, Action, Ally, Funding } from "./card";
import { PlayerDeck } from "./deck";
import type { Game } from "./game";
import type { GameActionInternal } from "./types";
import {
  CHARACTER_CARD_RATINGS,
  CHARACTER_BUFFERS,
  MISSION_RATINGS,
  type CardRatings,
} from "./data/botWeights";

/**
 * Twonky bot — priority-based AI using pre-computed card ratings.
 * Port of Python engine/robot.py class Twonky (lines 1768-2143).
 */
export class Twonky extends Player {
  protected cardData: Record<string, number> = {};
  protected missionLookup: Record<string, number>;
  protected buffer: number;
  private seekCount = 0;

  constructor(deck: PlayerDeck, game: Game, turnOrder: number, name = "Twonky", character = "Marsh") {
    super(deck, game, turnOrder, name, character);

    // Load character-specific card ratings
    this.buffer = CHARACTER_BUFFERS[character] ?? 0;
    const rawRatings: CardRatings | undefined = CHARACTER_CARD_RATINGS[character];
    if (rawRatings) {
      for (const [cardName, tuple] of Object.entries(rawRatings)) {
        this.cardData[cardName] = tuple[2]; // winRate
      }
    } else {
      // Fallback: neutral 0.5 for everything
      this.cardData = {};
    }

    this.missionLookup = { ...MISSION_RATINGS };
  }

  // ── Card evaluation ──

  protected cardLookup(card: Card): number {
    return this.cardData[card.name] ?? 0.5;
  }

  protected sortingAlgo(card: Card): number {
    return this.cardLookup(card);
  }

  // ── Action selection ──

  override selectAction(actions: GameActionInternal[], game: Game): GameActionInternal {
    // 1. Mission advances (sorted by mission rating)
    const missionActions = actions
      .filter((a): a is GameActionInternal & { type: "advance_mission" } => a.type === "advance_mission")
      .sort((a, b) => (this.missionLookup[a.mission.name] ?? 0.5) - (this.missionLookup[b.mission.name] ?? 0.5));
    if (missionActions.length > 0) return missionActions[0];

    // 2. Ally and character abilities
    const abilities = actions.filter((a) =>
      a.type === "ally_ability_1" || a.type === "ally_ability_2" ||
      a.type === "char_ability_1" || a.type === "char_ability_3"
    );
    if (abilities.length > 0) return abilities[0];

    // 3. Play metals on cards (highest rated first)
    const handScores = this.deck.hand
      .filter((c): c is Action => c instanceof Action)
      .map((c) => ({ card: c, score: this.sortingAlgo(c) }))
      .sort((a, b) => b.score - a.score);

    const isBurnAvailable = () =>
      (this.metalTokens.slice(0, -1).filter((v) => v === 1).length + this.metalTokens[8]) < this.burns;

    for (const { card } of handScores) {
      if (card.burned || card.metalUsed >= card.capacity) continue;

      // Try use_metal
      const useMetal = actions.find((a) => a.type === "use_metal" && "card" in a && a.card === card);
      if (useMetal) return useMetal;

      // Try refresh
      const refresh = actions.filter((a): a is GameActionInternal & { type: "refresh_metal" } =>
        a.type === "refresh_metal"
      ).sort((a, b) => this.sortingAlgo((a as any).card) - this.sortingAlgo((b as any).card));
      const refreshForCard = refresh.find((a) => a.card === card);
      if (refreshForCard) return refresh[0]; // Use lowest-rated card to refresh

      // Try burn metal token
      if (isBurnAvailable()) {
        const burnMetal = actions.find((a) => a.type === "burn_metal" && a.metalIndex === card.metal);
        if (burnMetal) return burnMetal;
      }

      // Early game: flare instead
      if (game.turncount < 6) {
        const flare = actions.find((a) => a.type === "flare_metal" && a.metalIndex === card.metal);
        if (flare) return flare;
      }

      // Burn a low-rated hand card for this metal
      const curIdx = handScores.findIndex((h) => h.card === card);
      for (let i = handScores.length - 1; i > curIdx; i--) {
        const burnCard = actions.find((a) =>
          a.type === "burn_card" && "card" in a && a.card === handScores[i].card &&
          a.metalIndex === card.metal
        );
        if (burnCard) return burnCard;
      }

      // Try atium
      const atium = actions.find((a) => a.type === "use_atium" && a.metalIndex === card.metal);
      if (atium) return atium;
    }

    // 4. Extraneous burns (leftover cards)
    const extraBurns = actions.filter((a) => a.type === "burn_card");
    if (extraBurns.length > 0) return extraBurns[0];

    // 5. Try to activate ally abilities that need metals
    const metalPrio: { card: Ally; metal: number }[] = [];
    for (const c of this.allies) {
      if (c.available2 && this.metalBurned[c.metal] > 1) metalPrio.push({ card: c, metal: c.metal });
    }
    for (const c of this.allies) {
      if (c.available1) metalPrio.push({ card: c, metal: c.metal });
    }
    for (const { metal } of metalPrio) {
      const burn = actions.find((a) => a.type === "burn_metal" && a.metalIndex === metal);
      if (burn) return burn;
      const flare = actions.find((a) => a.type === "flare_metal" && a.metalIndex === metal);
      if (flare) return flare;
      for (const c of this.deck.hand) {
        const burnCard = actions.find((a) =>
          a.type === "burn_card" && "card" in a && a.card === c && a.metalIndex === metal
        );
        if (burnCard) return burnCard;
      }
    }

    // 6. Character ability 1 metal
    const selfMetal = parseInt(this.ability1metal, 10);
    if (this.charAbility1 && this.training >= 5) {
      const burn = actions.find((a) => a.type === "burn_metal" && a.metalIndex === selfMetal);
      if (burn) return burn;
      for (const c of this.deck.hand) {
        const burnCard = actions.find((a) =>
          a.type === "burn_card" && "card" in a && a.card === c && a.metalIndex === selfMetal
        );
        if (burnCard) return burnCard;
      }
    }

    // 7. Character ability 3 (atium)
    if (this.charAbility3 && this.training >= 13) {
      for (const { metal } of metalPrio) {
        const atium = actions.find((a) => a.type === "use_atium" && a.metalIndex === metal);
        if (atium) return atium;
      }
    }

    // 8. Any remaining refresh
    const refreshActions = actions.filter((a) => a.type === "refresh_metal");
    if (refreshActions.length > 0) return refreshActions[0];

    // 9. Buy with boxings (high-cost non-allies)
    const boxingBuys = actions
      .filter((a): a is GameActionInternal & { type: "buy_with_boxings" } =>
        a.type === "buy_with_boxings" && a.card.cost > 5 && !(a.card instanceof Ally)
      )
      .sort((a, b) => this.sortingAlgo(b.card) - this.sortingAlgo(a.card));
    if (boxingBuys.length > 0) return boxingBuys[0];

    // 10. Normal buys (rated above buffer)
    const buys = actions
      .filter((a): a is GameActionInternal & { type: "buy" } =>
        a.type === "buy" && this.sortingAlgo(a.card) >= this.buffer
      )
      .sort((a, b) => this.sortingAlgo(b.card) - this.sortingAlgo(a.card));

    if (buys.length > 0) {
      const hasExpensiveCard = game.market.hand.some((c) => c.cost > 6 && !(c instanceof Ally));
      if (this.curMoney > 2 || hasExpensiveCard) return buys[0];
    }

    // 11. Buy+eliminate (lower threshold)
    const lowBuffer = this.buffer > 0 ? this.buffer * 0.5 : this.buffer < 0 ? this.buffer * 1.5 : -0.1;
    const useBuys = actions
      .filter((a) =>
        (a.type === "buy_eliminate" || a.type === "buy_elim_boxings") &&
        "card" in a && this.sortingAlgo(a.card) >= lowBuffer
      )
      .sort((a, b) =>
        this.sortingAlgo("card" in b ? b.card : ({} as Card)) -
        this.sortingAlgo("card" in a ? a.card : ({} as Card))
      );
    if (useBuys.length > 0) return useBuys[0];

    // 12. End turn
    this.seekCount = 0;
    return actions.find((a) => a.type === "end_actions")!;
  }

  // ── Decision overrides ──

  override assignDamageIn(targets: Ally[]): number {
    if (targets.length === 0) return -1;
    const options = targets
      .map((t, i) => ({ i, score: this.cardLookup(t) }))
      .sort((a, b) => b.score - a.score);
    for (const { i, score } of options) {
      if (score > 0.5) return i;
    }
    return -1;
  }

  override senseCheckIn(_card: Action): boolean { return true; }

  override killEnemyAllyIn(allies: Ally[]): number {
    if (allies.length === 0) return -1;
    return allies.reduce((best, ally, i) =>
      ally.health > allies[best].health ? i : best, 0);
  }

  override cloudAlly(_card: Card, _ally: Ally): boolean { return false; }

  override eliminateIn(): number {
    const h = this.deck.hand.length;
    const d = this.deck.discard.length;
    const c = this.deck.cards.length;
    if (d + h + c < 6) return -1;
    // Prioritize eliminating Funding
    for (let i = 0; i < this.deck.hand.length; i++) {
      if (this.deck.hand[i] instanceof Funding) return i;
    }
    for (let i = 0; i < this.deck.discard.length; i++) {
      if (this.deck.discard[i] instanceof Funding) return i + h;
    }
    // Eliminate lowest-rated card below buffer
    const allCards = [...this.deck.hand, ...this.deck.discard];
    const candidates = allCards
      .map((card, idx) => ({ idx, card, score: this.sortingAlgo(card) }))
      .filter((c) => c.score < this.buffer);
    if (candidates.length === 0) return -1;
    const worst = candidates.reduce((a, b) => a.score < b.score ? a : b);
    return worst.idx;
  }

  override pullIn(): number {
    const sorted = this.deck.discard
      .map((c, i) => ({ i, score: this.sortingAlgo(c) }))
      .filter((c) => c.score > this.buffer)
      .sort((a, b) => b.score - a.score);
    return sorted.length > 0 ? sorted[0].i : -1;
  }

  override subdueIn(choices: Card[]): number {
    const sorted = choices
      .map((c, i) => ({ i, score: this.sortingAlgo(c) }))
      .filter((c) => c.score > this.buffer)
      .sort((a, b) => b.score - a.score);
    return sorted.length > 0 ? sorted[0].i : -1;
  }

  override soarIn(choices: Card[]): number {
    const sorted = choices
      .map((c, i) => ({ i, score: this.sortingAlgo(c) }))
      .filter((c) => c.score > this.buffer)
      .sort((a, b) => b.score - a.score);
    return sorted.length > 0 ? sorted[0].i : -1;
  }

  override confrontationIn(choices: Action[]): number {
    const sorted = choices
      .map((c, i) => ({ i, score: this.sortingAlgo(c) }))
      .filter((c) => c.score > this.buffer)
      .sort((a, b) => b.score - a.score);
    return sorted.length > 0 ? sorted[0].i : -1;
  }

  override informantIn(card: Card): boolean {
    return this.sortingAlgo(card) <= 0.5;
  }

  override keeperIn(_choices: Card[]): number { return -1; }

  override chooseIn(options: string[]): number {
    if (options.includes("Mi")) return options.indexOf("Mi") >> 1;
    if (options.includes("T")) return options.indexOf("T") >> 1;
    if (options.includes("M")) return options.indexOf("M") >> 1;
    return Math.floor(Math.random() * (options.length / 2));
  }

  override refreshIn(): number {
    for (let i = 0; i < this.metalTokens.length; i++) {
      if (this.metalTokens[i] === 2 || this.metalTokens[i] === 4) return i;
    }
    return Math.floor(Math.random() * 8);
  }

  override pushIn(): number {
    const choices = this.game.market.hand;
    const sorted = choices
      .map((c, i) => ({ i, score: this.sortingAlgo(c) }))
      .filter((c) => c.score > this.buffer)
      .sort((a, b) => b.score - a.score);
    return sorted.length > 0 ? sorted[0].i : -1;
  }

  override riotIn(riotable: Ally[]): Ally {
    const sorted = riotable
      .map((c) => ({ card: c, score: this.sortingAlgo(c) }))
      .sort((a, b) => b.score - a.score);
    return sorted[0].card;
  }

  override seekIn(twice: boolean, _seeker: boolean, choices: Action[]): [number, number] {
    this.seekCount += 1;
    if (this.seekCount > 100) return [-1, -1];
    const sorted = choices
      .map((c, i) => ({ i, score: this.sortingAlgo(c) }))
      .sort((a, b) => b.score - a.score);
    if (sorted.length === 1 || !twice) {
      return [sorted[0].i, -1];
    } else if (sorted.length > 0) {
      return [sorted[0].i, sorted[1].i];
    }
    return [-1, -1];
  }

  override cloudP(card: Action): boolean {
    return card.name === "Coppercloud";
  }
}

/** Factory function for creating Twonky bots (matches PlayerFactory signature) */
export function createTwonky(
  deck: PlayerDeck,
  game: Game,
  turnOrder: number,
  name: string,
  character: string,
): Player {
  return new Twonky(deck, game, turnOrder, name, character);
}
