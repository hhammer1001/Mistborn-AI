/**
 * SynergyBotPrime — Eli's best bot, ported from Python at v1-with-eli commit 517dbe2.
 *
 * Architecture: priority-waterfall like FocusBot but evaluates card purchases by
 * pair-wise synergy (from self-play data), not flat per-card ratings. The bot
 * buys a card iff its average added synergy (valueAdd / numCards) exceeds the
 * current mean pair synergy of the deck.
 *
 * Data: per-character, per-turn-order synergy pairs in data/synergyData/{Char}{0|1}.json
 * Each file maps "A|B" → number, where A <= B alphabetically by name.
 */

import { Player } from "./player";
import { Card, Action, Ally } from "./card";
import { PlayerDeck } from "./deck";
import type { Game } from "./game";
import type { GameActionInternal } from "./types";

import Kelsier0 from "./data/synergyData/Kelsier0.json";
import Kelsier1 from "./data/synergyData/Kelsier1.json";
import Shan0 from "./data/synergyData/Shan0.json";
import Shan1 from "./data/synergyData/Shan1.json";
import Vin0 from "./data/synergyData/Vin0.json";
import Vin1 from "./data/synergyData/Vin1.json";
import Marsh0 from "./data/synergyData/Marsh0.json";
import Marsh1 from "./data/synergyData/Marsh1.json";
import Prodigy0 from "./data/synergyData/Prodigy0.json";
import Prodigy1 from "./data/synergyData/Prodigy1.json";

type SynergyTable = Record<string, number>;
const SYNERGY_DATA: Record<string, [SynergyTable, SynergyTable]> = {
  Kelsier: [Kelsier0 as SynergyTable, Kelsier1 as SynergyTable],
  Shan: [Shan0 as SynergyTable, Shan1 as SynergyTable],
  Vin: [Vin0 as SynergyTable, Vin1 as SynergyTable],
  Marsh: [Marsh0 as SynergyTable, Marsh1 as SynergyTable],
  Prodigy: [Prodigy0 as SynergyTable, Prodigy1 as SynergyTable],
};

// cardData.json in the source repo had all zeros except Funding (which isn't
// ever bought). The penalty term `0.2 * cardData[name] * count` is thus
// essentially dead for any real buy decision. Keep the signature, default 0.
const CARD_DATA: Record<string, number> = { Funding: 2.0 };

const KILL_ON_SIGHT = new Set(["Hazekillers", "Soldier", "Pewterarm"]);

// Mission preference order from SynergyBot.__init__
const MISSION_RANK = [
  "Kredik Shaw",
  "Luthadel Garrison",
  "Luthadel Rooftops",
  "Keep Venture",
  "Crew Hideout",
  "Pits Of Hathsin",
  "Canton Of Orthodoxy",
  "Skaa Caverns",
];

/**
 * SynergyBotPrime. Inlined — we don't separately expose SynergyBot since
 * SynergyBotPrime is what actually battled Twonky.
 */
export class SynergyBotPrime extends Player {
  private synergy: SynergyTable;
  private cardData = CARD_DATA;
  private numCards = 0;
  private totalValue = 0;
  private count = 0;

  constructor(deck: PlayerDeck, game: Game, turnOrder: number, name = "Synergy", character = "Kelsier") {
    super(deck, game, turnOrder, name, character);

    // Pick per-character, per-turn-order synergy table (fallback: Kelsier0).
    const charTables = SYNERGY_DATA[character] ?? SYNERGY_DATA.Kelsier;
    // Copy so we can add fallback 1.0 entries without mutating the imported JSON.
    this.synergy = { ...charTables[turnOrder === 1 ? 1 : 0] };

    // Initialize totalValue = sum over all pairs (i<j, alphabetically ordered).
    const cards = [...this.deck.cards, ...this.deck.hand];
    this.numCards = cards.length;
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        this.totalValue += this.pairValue(cards[i].name, cards[j].name);
      }
    }
  }

  private synKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  private pairValue(a: string, b: string): number {
    const k = this.synKey(a, b);
    const v = this.synergy[k];
    if (v === undefined) {
      // Unknown pair: default to 1.0 and memoize (mirrors Python).
      this.synergy[k] = 1.0;
      return 1.0;
    }
    return v;
  }

  /** Synergy added by a new `card` vs the rest of this bot's deck. */
  private valueAdd(card: Card): number {
    const cards = [
      ...this.deck.hand,
      ...this.deck.cards,
      ...this.deck.discard,
      ...this.deck.setAside,
    ];
    let newSyn = 0;
    for (const dc of cards) {
      if (!dc) continue;
      newSyn += this.pairValue(card.name, dc.name);
    }
    const penalty = 0.2 * (this.cardData[card.name] ?? 0) * this.count;
    return newSyn - penalty;
  }

  private meanPairSynergy(): number {
    if (this.numCards < 2) return 0;
    return (2 * this.totalValue) / (this.numCards * (this.numCards - 1));
  }

  // ── playTurn: guard against rare undefined-in-hand bug ──

  override playTurn(game: Game) {
    this.deck.hand = this.deck.hand.filter((c) => c != null);
    super.playTurn(game);
  }

  // ── Action selection (SynergyBotPrime.selectAction) ──

  override selectAction(actions: GameActionInternal[], _game: Game): GameActionInternal {
    // 1. Ally/char abilities (codes 8,9,10,11), skipping Keeper ability 1
    for (const a of actions) {
      if (a.type === "ally_ability_1" || a.type === "ally_ability_2" ||
          a.type === "char_ability_1" || a.type === "char_ability_3") {
        if (a.type === "ally_ability_1" && (a.card as Ally).name === "Keeper") continue;
        return a;
      }
    }

    // 2. Highest-cost use_metal (code 4)
    let highestCost = 0;
    let highestUseMetal: (GameActionInternal & { type: "use_metal" }) | null = null;
    for (const a of actions) {
      if (a.type === "use_metal" && a.card.cost > highestCost) {
        highestCost = a.card.cost;
        highestUseMetal = a;
      }
    }
    if (highestCost > 0.1 && highestUseMetal) return highestUseMetal;

    // 3. Any use_metal (the Python loop runs even after step 2; here it's fallback)
    const anyUseMetal = actions.find((a) => a.type === "use_metal");
    if (anyUseMetal) return anyUseMetal;

    // 4. burn_metal/flare_metal (code 5) for a hand card that still wants metal
    for (const c of this.deck.hand) {
      if (c instanceof Action && !c.burned && c.metalUsed < c.capacity) {
        const m = actions.find((a) =>
          (a.type === "burn_metal" || a.type === "flare_metal") && a.metalIndex === c.metal
        );
        if (m) return m;
      }
    }

    // 5. Any refresh_metal (code 3)
    const refresh = actions.find((a) => a.type === "refresh_metal");
    if (refresh) return refresh;

    // 6. burn_card (code 2) matching the metal of a live hand card, and not itself
    for (const c of this.deck.hand) {
      if (c instanceof Action && !c.burned && c.metalUsed < c.capacity) {
        const burn = actions.find((a) =>
          a.type === "burn_card" && a.metalIndex === c.metal && a.card !== c
        );
        if (burn) return burn;
      }
    }

    // 7. Any burn_card
    const anyBurn = actions.find((a) => a.type === "burn_card");
    if (anyBurn) return anyBurn;

    // 8. advance_mission, preferred in MISSION_RANK order
    const missionActs = actions.filter(
      (a): a is GameActionInternal & { type: "advance_mission" } => a.type === "advance_mission"
    );
    if (missionActs.length > 0) {
      for (const name of MISSION_RANK) {
        const found = missionActs.find((a) => a.mission.name === name);
        if (found) return found;
      }
    }

    // 9. use_atium (code 12) targeting a hand card's metal if that card still wants metal
    for (const a of actions) {
      if (a.type === "use_atium") {
        const live = this.deck.hand.some((c) =>
          c instanceof Action && !c.burned && c.metalUsed < c.capacity && c.metal === a.metalIndex
        );
        if (live) return a;
      }
    }

    // 10. Best buy/buy_with_boxings by valueAdd, buy if average > current mean pair synergy
    let bestBuyVal = 0;
    let bestBuy: GameActionInternal | null = null;
    for (const a of actions) {
      if (a.type === "buy" || a.type === "buy_with_boxings") {
        const k = this.valueAdd(a.card);
        if (k > bestBuyVal) {
          bestBuyVal = k;
          bestBuy = a;
        }
      }
    }
    const curscore = this.meanPairSynergy();
    if (bestBuy && this.numCards > 0 && (bestBuyVal / this.numCards) > curscore) {
      this.totalValue += bestBuyVal;
      this.numCards += 1;
      return bestBuy;
    }

    // 11. buy_eliminate (code 7) highest-cost, if cost > 0.001
    let highestElimCost = 0;
    let bestElim: GameActionInternal | null = null;
    for (const a of actions) {
      if (a.type === "buy_eliminate" && a.card.cost > highestElimCost) {
        highestElimCost = a.card.cost;
        bestElim = a;
      }
    }
    if (bestElim && highestElimCost > 0.001) return bestElim;

    // 12. buy_elim_boxings (code 14)
    const elimBoxings = actions.find((a) => a.type === "buy_elim_boxings");
    if (elimBoxings) return elimBoxings;

    // 13. Fallback: Keeper ability 1 (we skipped it at step 1)
    const keeperAbility = actions.find(
      (a) => a.type === "ally_ability_1" && (a.card as Ally).name === "Keeper"
    );
    if (keeperAbility) return keeperAbility;

    // 14. End turn
    this.count += 1;
    const end = actions.find((a) => a.type === "end_actions");
    if (end) return end;
    return actions[0];
  }

  // ── Decision overrides (mostly inherited from FocusBot semantics) ──

  override assignDamageIn(targets: Ally[]): number {
    for (let i = 0; i < targets.length; i++) {
      if (KILL_ON_SIGHT.has(targets[i].name)) return i;
    }
    return -1;
  }

  override senseCheckIn(_card: Action): boolean { return true; }

  override killEnemyAllyIn(allies: Ally[]): number {
    for (let i = 0; i < allies.length; i++) {
      if (KILL_ON_SIGHT.has(allies[i].name)) return i;
    }
    return 0;
  }

  override cloudAlly(_card: Card, _ally: Ally): boolean { return true; }

  override eliminateIn(): number {
    // FocusBot behavior: eliminate card with lowest cardData value below mean.
    // With CARD_DATA mostly empty (0), the lowest is always 0, so we'd always
    // pick the first hand card. Improve with synergy-based removal: the card
    // whose removal gains the most (i.e., removes negative synergy).
    const all = [...this.deck.hand, ...this.deck.discard];
    if (all.length + this.deck.cards.length < 6) return -1;

    let bestIdx = -1;
    let bestDelta = 0; // positive means removal improves mean
    for (let i = 0; i < all.length; i++) {
      const c = all[i];
      if (c instanceof Ally) continue; // can't eliminate allies
      const removedSyn = this.valueAdd(c); // synergy c contributes
      // Delta to mean pair synergy when we drop one card.
      // Before: totalValue/C(n,2). After: (totalValue - removedSyn)/C(n-1,2).
      const n = this.numCards;
      if (n < 2) continue;
      const before = this.totalValue / (n * (n - 1));
      const after = (this.totalValue - removedSyn) / ((n - 1) * (n - 2) || 1);
      const delta = after - before;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return -1;
    // Update bookkeeping
    const c = all[bestIdx];
    this.totalValue -= this.valueAdd(c);
    this.numCards -= 1;
    return bestIdx;
  }

  override pullIn(): number {
    const cur = this.meanPairSynergy();
    let bestIdx = -1;
    let bestPer = cur;
    for (let i = 0; i < this.deck.discard.length; i++) {
      const v = this.valueAdd(this.deck.discard[i]);
      const per = this.numCards > 0 ? v / this.numCards : v;
      if (per > bestPer) {
        bestPer = per;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  override subdueIn(choices: Card[]): number {
    const cur = this.meanPairSynergy();
    let bestIdx = -1;
    let bestVal = 0;
    for (let i = 0; i < choices.length; i++) {
      const v = this.valueAdd(choices[i]);
      const per = this.numCards > 0 ? v / this.numCards : v;
      if (per > cur && v > bestVal) {
        bestVal = v;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      this.totalValue += bestVal;
      this.numCards += 1;
    }
    return bestIdx;
  }

  override soarIn(choices: Card[]): number {
    return this.subdueIn(choices);
  }

  override confrontationIn(choices: Action[]): number {
    // Use the card whose synergy add is highest (skip Confrontation itself).
    let bestIdx = -1;
    let bestVal = 0;
    for (let i = 0; i < choices.length; i++) {
      if (choices[i].name === "Confrontation") continue;
      const v = this.valueAdd(choices[i]);
      if (v > bestVal) {
        bestVal = v;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  override informantIn(card: Card): boolean {
    // Eliminate top-of-deck if removing it would raise mean pair synergy.
    const removedSyn = this.valueAdd(card);
    const n = this.numCards;
    if (n < 3) return false;
    const before = this.totalValue / (n * (n - 1));
    const after = (this.totalValue - removedSyn) / ((n - 1) * (n - 2));
    if (after > before) {
      this.totalValue -= removedSyn;
      this.numCards -= 1;
      return true;
    }
    return false;
  }

  override keeperIn(choices: Card[]): number {
    // FocusBot (post-Jan-18): pick highest cardData value. With CARD_DATA mostly
    // zeros, prefer the card with the highest synergy add to keep in play.
    let bestIdx = -1;
    let bestVal = 0;
    for (let i = 0; i < choices.length; i++) {
      const v = this.valueAdd(choices[i]);
      if (v > bestVal) {
        bestVal = v;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  override chooseIn(options: string[]): number {
    const k = Math.max(0, Math.floor(options.length / 2) - 1);
    return Math.floor(Math.random() * (k + 1));
  }

  override refreshIn(): number {
    for (let i = 0; i < this.metalTokens.length; i++) {
      if (this.metalTokens[i] === 2 || this.metalTokens[i] === 4) return i;
    }
    return Math.floor(Math.random() * 8);
  }

  override pushIn(): number {
    const len = this.game.market.hand.length;
    return Math.floor(Math.random() * (len + 1)) - 1;
  }

  override riotIn(riotable: Ally[]): Ally {
    return riotable[Math.floor(Math.random() * riotable.length)];
  }

  override seekIn(twice: boolean, _seeker: boolean, choices: Action[]): [number, number] {
    if (choices.length === 0) return [-1, -1];
    const choice = Math.floor(Math.random() * (choices.length + 1)) - 1;
    let choice2 = -1;
    if (twice) {
      choice2 = Math.floor(Math.random() * choices.length) - 1;
      if (choice === choice2 && choice > -1) choice2 += 1;
    }
    return [choice, choice2];
  }

  override cloudP(_card: Action): boolean { return true; }
}

export function createSynergyBotPrime(
  deck: PlayerDeck,
  game: Game,
  turnOrder: number,
  name: string,
  character: string,
): Player {
  return new SynergyBotPrime(deck, game, turnOrder, name, character);
}
