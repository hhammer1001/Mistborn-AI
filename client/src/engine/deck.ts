import { Card, Ally, Funding, createCard } from "./card";
import type { CardDef } from "./types";
import { STARTER_DECKS } from "./data/starterDecks";
import { MARKET_DECK } from "./data/marketDeck";

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Base Deck ──

export class Deck {
  hand: Card[] = [];
  cards: Card[] = [];
  discard: Card[] = [];
  setAside: Card[] = [];

  draw(amount: number) {
    for (let i = 0; i < amount; i++) {
      if (this.cards.length === 0) {
        this.cards = this.discard;
        this.discard = [];
        shuffle(this.cards);
        if (this.cards.length === 0) return;
      }
      this.hand.push(this.cards.shift()!);
    }
  }
}

// ── Player Deck ──

export interface PlayerLike {
  handSize: number;
  allies: Ally[];
  money(n: number): void;
  extraBurn(n: number): void;
  permDraw(n: number): void;
  smoking: boolean;
}

export class PlayerDeck extends Deck {
  constructor(characterCode: string) {
    super();
    // Select starter deck group based on character
    const deckGroup = ["Kelsier", "Shan"].includes(characterCode) ? 0 : 1;
    const defs = STARTER_DECKS.filter((d) => d.deckGroup === deckGroup);
    for (const def of defs) {
      this.cards.push(createCard(def));
    }
    shuffle(this.cards);
  }

  /** Draw cards, auto-playing Allies and Funding as they're drawn */
  override draw(amount: number, player?: PlayerLike) {
    if (!player) {
      // Fallback for base Deck compatibility (Market uses this)
      super.draw(amount);
      return;
    }
    for (let i = 0; i < amount; i++) {
      if (this.cards.length === 0) {
        this.cards = this.discard;
        this.discard = [];
        shuffle(this.cards);
        if (this.cards.length === 0) return;
      }
      const card = this.cards.shift()!;
      if (card instanceof Ally) {
        card.play(player);
        player.allies.push(card);
      } else {
        this.hand.push(card);
      }
      if (card instanceof Funding) {
        card.play(player);
      }
    }
  }

  /** End of turn: discard hand, draw new hand, restore set-aside cards */
  cleanUp(player: PlayerLike, market?: Market) {
    for (const card of this.hand) {
      card.reset();
    }
    this.discard.push(...this.hand);
    this.hand = [];
    this.draw(player.handSize, player);
    this.hand.push(...this.setAside);
    this.setAside = [];
    if (market) {
      for (const card of market.hand) {
        card.sought = false;
      }
    }
  }

  /** Remove a card by index (hand first, then discard) */
  eliminate(choice: number): Card {
    const h = this.hand.length;
    if (choice < h) {
      return this.hand.splice(choice, 1)[0];
    } else {
      return this.discard.splice(choice - h, 1)[0];
    }
  }

  add(card: Card) {
    this.discard.push(card);
  }
}

// ── Market ──

export class Market extends Deck {
  constructor(testDeck = false) {
    super();
    if (testDeck) {
      this._buildTestDeck();
    } else {
      for (const def of MARKET_DECK) {
        this.cards.push(createCard(def));
      }
    }
    shuffle(this.cards);
    this.draw(6);
  }

  private _buildTestDeck() {
    // Test deck for reproducing the Seeker + riot + seek bug.
    // Market-side: Seeker (bronze ally with seek-5 / special16), plus several
    // riotable action cards so seek has targets that will riot Seeker back.
    const seekerDef: CardDef = {
      cardType: 3, name: "Seeker", cost: 5, metal: 2,
      ability1Effect: "seek", ability1Amount: "-5",
      ability2Effect: "special16", ability2Amount: "0",
      health: 3,
    };
    const enrageDef: CardDef = {
      cardType: 2, name: "Enrage", cost: 2, metal: 4,
      ability1Effect: "D.M.riot", ability1Amount: "1.2.0",
    };
    const inspireDef: CardDef = {
      cardType: 2, name: "Inspire", cost: 3, metal: 4,
      ability1Effect: "M.riot", ability1Amount: "3.1",
    };
    // A Houselord for money/draw (useful filler)
    const houselordDef: CardDef = {
      cardType: 3, name: "Houselord", cost: 3, metal: 1,
      ability1Effect: "M", ability1Amount: "2",
      ability2Effect: "C", ability2Amount: "1",
      health: 2,
    };
    // Push plenty of copies so market.hand + refills will always contain them.
    for (let i = 0; i < 10; i++) {
      this.cards.push(createCard(seekerDef));
      this.cards.push(createCard(enrageDef));
      this.cards.push(createCard(inspireDef));
      this.cards.push(createCard(houselordDef));
    }
  }

  buy(card: Card) {
    const idx = this.hand.indexOf(card);
    if (idx !== -1) {
      this.hand.splice(idx, 1);
    }
    this.draw(1);
  }
}
