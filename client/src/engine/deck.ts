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

function cloneThrough(original: Card, cardMap: Map<number, Card>): Card {
  const existing = cardMap.get(original.id);
  if (existing) return existing;
  const cloned = original.clone();
  cardMap.set(original.id, cloned);
  return cloned;
}

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

  /** Draw cards. By default, auto-plays Allies (→ zone) and Funding (→ money)
   *  as they're drawn — this matches mid-turn draws (C reward, Lookout, etc.).
   *  With `deferred: true`, allies and funding go into the hand marked as
   *  `pending`, to be played at the owner's next turn start. Used by cleanUp. */
  override draw(amount: number, player?: PlayerLike, opts?: { deferred?: boolean }) {
    if (!player) {
      super.draw(amount);
      return;
    }
    const deferred = opts?.deferred ?? false;
    for (let i = 0; i < amount; i++) {
      if (this.cards.length === 0) {
        this.cards = this.discard;
        this.discard = [];
        shuffle(this.cards);
        if (this.cards.length === 0) return;
      }
      const card = this.cards.shift()!;
      if (deferred) {
        if (card instanceof Ally || card instanceof Funding) {
          card.pending = true;
          this.hand.push(card);
        } else {
          this.hand.push(card);
        }
      } else {
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
  }

  /** End of turn: discard hand, draw new hand (pending), restore set-aside cards */
  cleanUp(player: PlayerLike, market?: Market) {
    for (const card of this.hand) {
      card.reset();
    }
    this.discard.push(...this.hand);
    this.hand = [];
    this.draw(player.handSize, player, { deferred: true });
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

  clone(cardMap: Map<number, Card>): PlayerDeck {
    const d = Object.create(PlayerDeck.prototype) as PlayerDeck;
    d.hand = this.hand.map((c) => cloneThrough(c, cardMap));
    d.cards = this.cards.map((c) => cloneThrough(c, cardMap));
    d.discard = this.discard.map((c) => cloneThrough(c, cardMap));
    d.setAside = this.setAside.map((c) => cloneThrough(c, cardMap));
    return d;
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
    const hazekillerDef: CardDef = {
      cardType: 3, name: "Hazekillers", cost: 4, metal: -1,
      health: 3, defenseType: "D",
    };
    for (let i = 0; i < 20; i++) {
      this.cards.push(createCard(hazekillerDef));
    }
  }

  buy(card: Card) {
    const idx = this.hand.indexOf(card);
    if (idx !== -1) {
      this.hand.splice(idx, 1);
    }
    this.draw(1);
  }

  clone(cardMap: Map<number, Card>): Market {
    const m = Object.create(Market.prototype) as Market;
    m.hand = this.hand.map((c) => cloneThrough(c, cardMap));
    m.cards = this.cards.map((c) => cloneThrough(c, cardMap));
    m.discard = this.discard.map((c) => cloneThrough(c, cardMap));
    m.setAside = this.setAside.map((c) => cloneThrough(c, cardMap));
    return m;
  }
}
