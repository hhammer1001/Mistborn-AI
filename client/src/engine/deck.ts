import { Card, Ally, Funding, createCard } from "./card";
import type { CardDef } from "./types";
import { STARTER_DECKS } from "./data/starterDecks";
import { MARKET_DECK } from "./data/marketDeck";
import { Rng } from "./rng";

function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
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
  /** Stream used for mid-game reshuffles. Set by subclass constructors;
   *  cloned decks (Object.create) must copy this from the original. */
  rng!: Rng;
  /** Set whenever a mid-game reshuffle happens (discard → draw pile, then
   *  shuffled). Session drains this into the activity log and clears it. */
  shuffleOccurred = false;

  draw(amount: number) {
    for (let i = 0; i < amount; i++) {
      if (this.cards.length === 0) {
        this.cards = this.discard;
        this.discard = [];
        shuffle(this.cards, this.rng);
        this.shuffleOccurred = true;
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
  /** initRng is consumed exactly once for the constructor's initial shuffle.
   *  gameRng is retained on `this.rng` for every mid-game reshuffle. Splitting
   *  the two streams keeps the initial deck order stable across unrelated
   *  changes elsewhere in the engine. */
  constructor(characterCode: string, initRng: Rng, gameRng: Rng) {
    super();
    this.rng = gameRng;
    // Select starter deck group based on character
    const deckGroup = ["Kelsier", "Shan"].includes(characterCode) ? 0 : 1;
    const defs = STARTER_DECKS.filter((d) => d.deckGroup === deckGroup);
    for (const def of defs) {
      this.cards.push(createCard(def));
    }
    shuffle(this.cards, initRng);
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
        shuffle(this.cards, this.rng);
        this.shuffleOccurred = true;
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
    d.rng = this.rng.clone();
    return d;
  }
}

// ── Market ──

export class Market extends Deck {
  /** marketRng is consumed exactly once for the initial shuffle (and is
   *  intentionally an independent stream so the market order stays fixed
   *  across unrelated changes). gameRng handles any future reshuffle. */
  constructor(testDeck: boolean, marketRng: Rng, gameRng: Rng) {
    super();
    this.rng = gameRng;
    if (testDeck) {
      this._buildTestDeck();
    } else {
      for (const def of MARKET_DECK) {
        this.cards.push(createCard(def));
      }
    }
    shuffle(this.cards, marketRng);
    this.draw(6);
  }

  private _buildTestDeck() {
    // 10 Charm + 10 Intimidate — both are cost-3 zinc (metal=4) action
    // cards with ability 1 + ability 2. Duplicate names exercise the
    // A/B/C copy-label UI in hand, and a hand of all-zinc cards lets the
    // player keep burning one to fuel another card's ability progression.
    const charmDef: CardDef = {
      cardType: 2, name: "Charm", cost: 3, metal: 4,
      ability1Effect: "M", ability1Amount: "3",
      ability2Effect: "M", ability2Amount: "2",
      burnEffect: "M", burnAmount: "2",
    };
    const intimidateDef: CardDef = {
      cardType: 2, name: "Intimidate", cost: 3, metal: 4,
      ability1Effect: "M", ability1Amount: "3",
      ability2Effect: "M.C", ability2Amount: "1.1",
    };
    for (let i = 0; i < 10; i++) this.cards.push(createCard(charmDef));
    for (let i = 0; i < 10; i++) this.cards.push(createCard(intimidateDef));
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
    m.rng = this.rng.clone();
    return m;
  }
}
