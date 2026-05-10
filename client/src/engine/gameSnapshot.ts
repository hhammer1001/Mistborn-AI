/**
 * gameSnapshot.ts — Standalone Game-level state snapshot / restore.
 *
 * Lifted from session.ts's prompt-rollback logic so it can be used outside
 * of a GameSession (e.g. ZoomBot lookahead during benchmarks). Captures all
 * mutable state needed to re-run an action sequence and roll back.
 *
 * Subset of GameSnapshot fields are kept compared to session.ts — we don't
 * need log lengths, hidden-card tracking, or external-data bookkeeping for
 * AI lookahead.
 */

import type { Game } from "./game";
type DeckEvent = Game["deckEvents"][number];
import { Action, Ally, Card } from "./card";
import type { Player } from "./player";
import type { Rng } from "./rng";

interface PlayerSnap {
  curDamage: number;
  curMoney: number;
  curMission: number;
  curHealth: number;
  curBoxings: number;
  training: number;
  atium: number;
  burns: number;
  pDamage: number;
  pMoney: number;
  handSize: number;
  alive: boolean;
  smoking: boolean;
  charAbility1: boolean;
  charAbility2: boolean;
  charAbility3: boolean;
  metalTokens: number[];
  metalAvailable: number[];
  metalBurned: number[];
  activeCardId: number | null;
  allyIds: number[];
  handIds: number[];
  deckIds: number[];
  discardIds: number[];
  setAsideIds: number[];
  eliminatedCardNames: string[];
}

interface CardStateSnap {
  sought: boolean;
  pending: boolean;
  burned?: boolean;
  metalUsed?: number;
  available1?: boolean;
  available2?: boolean;
  availableRiot?: boolean;
}

export interface GameStateSnap {
  winnerIndex: number | null;
  victoryType: string;
  turncount: number;
  missionRanks: number[][];
  missionTopReachedBy: (number | null)[];
  marketHand: number[];
  marketCards: number[];
  marketDiscard: number[];
  players: PlayerSnap[];
  cardStates: Map<number, CardStateSnap>;
  /** RNG snapshots — gameRng (shared by market & per-player decks for
   * shuffles) + each botRng. Critical for lookahead: without these,
   * simulations consume RNG calls (e.g. shuffle on cleanup) that advance
   * the rng past where it'd be without lookahead, polluting actual play. */
  gameRng: Rng;
  botRngs: Rng[];
  /** Captured so bot-lookahead simulations don't leak in-sim events (draws,
   *  damage/mission gains) into the real activity log after restoreGame. */
  deckEvents: DeckEvent[];
}

function allCards(game: Game): Card[] {
  const cards: Card[] = [];
  cards.push(...game.market.hand, ...game.market.cards, ...game.market.discard);
  for (const p of game.players) {
    cards.push(...p.deck.hand, ...p.deck.cards, ...p.deck.discard, ...p.deck.setAside);
    cards.push(...p.allies);
  }
  return cards;
}

export function snapshotGame(game: Game): GameStateSnap {
  const winner = game.winner;
  const players: PlayerSnap[] = game.players.map((p) => ({
    curDamage: p.curDamage, curMoney: p.curMoney, curMission: p.curMission,
    curHealth: p.curHealth, curBoxings: p.curBoxings, training: p.training,
    atium: p.atium, burns: p.burns, pDamage: p.pDamage, pMoney: p.pMoney,
    handSize: p.handSize, alive: p.alive, smoking: p.smoking,
    charAbility1: p.charAbility1, charAbility2: p.charAbility2, charAbility3: p.charAbility3,
    metalTokens: [...p.metalTokens],
    metalAvailable: [...p.metalAvailable],
    metalBurned: [...p.metalBurned],
    activeCardId: p._active_card?.id ?? null,
    allyIds: p.allies.map((a) => a.id),
    handIds: p.deck.hand.map((c) => c.id),
    deckIds: p.deck.cards.map((c) => c.id),
    discardIds: p.deck.discard.map((c) => c.id),
    setAsideIds: p.deck.setAside.map((c) => c.id),
    eliminatedCardNames: [...p.eliminatedCardNames],
  }));

  const cardStates = new Map<number, CardStateSnap>();
  for (const c of allCards(game)) {
    const s: CardStateSnap = { sought: c.sought, pending: c.pending };
    if (c instanceof Action) { s.burned = c.burned; s.metalUsed = c.metalUsed; }
    else if (c instanceof Ally) {
      s.available1 = c.available1;
      s.available2 = c.available2;
      s.availableRiot = c.availableRiot;
    }
    cardStates.set(c.id, s);
  }

  return {
    winnerIndex: winner ? winner.turnOrder : null,
    victoryType: game.victoryType,
    turncount: game.turncount,
    missionRanks: game.missions.map((m) => [...m.playerRanks]),
    missionTopReachedBy: game.missions.map((m) => m.topReachedBy),
    marketHand: game.market.hand.map((c) => c.id),
    marketCards: game.market.cards.map((c) => c.id),
    marketDiscard: game.market.discard.map((c) => c.id),
    players,
    cardStates,
    gameRng: game.gameRng.clone(),
    botRngs: game.botRngs.map((r) => r.clone()),
    deckEvents: game.deckEvents.map((e) => ({ ...e })),
  };
}

export function restoreGame(game: Game, snap: GameStateSnap): void {
  const byId = new Map<number, Card>();
  for (const c of allCards(game)) byId.set(c.id, c);

  game.winner = snap.winnerIndex !== null ? game.players[snap.winnerIndex] : null;
  game.victoryType = snap.victoryType;
  game.turncount = snap.turncount;

  for (let i = 0; i < game.missions.length; i++) {
    game.missions[i].playerRanks = [...snap.missionRanks[i]];
    game.missions[i].topReachedBy = snap.missionTopReachedBy[i] ?? null;
  }
  game.market.hand = snap.marketHand.map((id) => byId.get(id)!).filter(Boolean);
  game.market.cards = snap.marketCards.map((id) => byId.get(id)!).filter(Boolean);
  game.market.discard = snap.marketDiscard.map((id) => byId.get(id)!).filter(Boolean);

  for (let i = 0; i < game.players.length; i++) {
    const p: Player = game.players[i];
    const ps = snap.players[i];
    p.curDamage = ps.curDamage; p.curMoney = ps.curMoney; p.curMission = ps.curMission;
    p.curHealth = ps.curHealth; p.curBoxings = ps.curBoxings; p.training = ps.training;
    p.atium = ps.atium; p.burns = ps.burns; p.pDamage = ps.pDamage; p.pMoney = ps.pMoney;
    p.handSize = ps.handSize; p.alive = ps.alive; p.smoking = ps.smoking;
    p.charAbility1 = ps.charAbility1; p.charAbility2 = ps.charAbility2; p.charAbility3 = ps.charAbility3;
    p.metalTokens = [...ps.metalTokens];
    p.metalAvailable = [...ps.metalAvailable];
    p.metalBurned = [...ps.metalBurned];
    p._active_card = ps.activeCardId !== null ? (byId.get(ps.activeCardId) ?? null) : null;
    p.allies = ps.allyIds.map((id) => byId.get(id) as Ally).filter(Boolean);
    p.deck.hand = ps.handIds.map((id) => byId.get(id)!).filter(Boolean);
    p.deck.cards = ps.deckIds.map((id) => byId.get(id)!).filter(Boolean);
    p.deck.discard = ps.discardIds.map((id) => byId.get(id)!).filter(Boolean);
    p.deck.setAside = ps.setAsideIds.map((id) => byId.get(id)!).filter(Boolean);
    p.eliminatedCardNames = [...ps.eliminatedCardNames];
  }

  for (const [id, s] of snap.cardStates) {
    const c = byId.get(id);
    if (!c) continue;
    c.sought = s.sought;
    c.pending = s.pending;
    if (c instanceof Action) {
      c.burned = s.burned ?? false;
      c.metalUsed = s.metalUsed ?? 0;
    } else if (c instanceof Ally) {
      c.available1 = s.available1 ?? false;
      c.available2 = s.available2 ?? false;
      c.availableRiot = s.availableRiot ?? false;
    }
  }

  // Restore RNG state. gameRng is the shared rng for all in-game shuffles
  // (market.rng aliases this), so restoring it covers market + decks too.
  game.gameRng = snap.gameRng.clone();
  game.market.rng = game.gameRng; // re-alias the shared reference
  for (let i = 0; i < game.players.length; i++) {
    game.players[i].deck.rng = game.gameRng;
  }
  for (let i = 0; i < game.botRngs.length; i++) {
    game.botRngs[i] = snap.botRngs[i].clone();
  }
  // Bots hold a reference to their rng — refresh that too if the bot exposes it.
  for (let i = 0; i < game.players.length; i++) {
    const p = game.players[i] as Player & { rng?: Rng };
    if (p.rng) p.rng = game.botRngs[i];
  }
  game.deckEvents = snap.deckEvents.map((e) => ({ ...e }));
}
