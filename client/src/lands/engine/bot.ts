import { countersAvailable, type LandsSession } from "./session";
import {
  LAND_TYPES,
  type GameState,
  type LandCard,
  type LandType,
  type PlayerState,
} from "./types";

/** Common interface for any bot that drives a seat. */
export interface ILandsBot {
  readonly seat: 0 | 1;
  step(state: GameState): boolean;
}

/**
 * Simple heuristic bot. Plays the highest-scoring legal card; counters only
 * when opponent's play would otherwise complete their win.
 *
 * Deterministic given the same game state (no randomness inside) — randomness
 * lives in the session's shuffle.
 */
export class LandsBot implements ILandsBot {
  private readonly session: LandsSession;
  /** Which seat the bot occupies. */
  readonly seat: 0 | 1;

  constructor(session: LandsSession, seat: 0 | 1) {
    this.session = session;
    this.seat = seat;
  }

  /** Decide and submit a move for the current phase. No-op if it's not the
   *  bot's turn to act for that phase. */
  step(state: GameState): boolean {
    if (state.phase === "game_over") return false;

    // Bot's main step.
    if (state.phase === "main" && state.activePlayer === this.seat) {
      this.takeMain(state);
      return true;
    }
    // Bot is the non-active player in a counter window.
    if (state.phase === "counter_window" && state.activePlayer !== this.seat) {
      this.takeCounter(state);
      return true;
    }
    // Bot's effect-resolution phases (only fire when bot is the active player).
    if (state.activePlayer !== this.seat) return false;

    switch (state.phase) {
      case "mountain_target":
        this.takeMountain(state);
        return true;
      case "swamp_view":
        this.takeSwamp(state);
        return true;
      case "forest_pick":
        this.takeForest(state);
        return true;
      case "island_scry":
        this.takeIsland(state);
        return true;
    }
    return false;
  }

  // ── Main step: score every hand card, play the best. ──

  private takeMain(state: GameState) {
    const me = state.players[this.seat];
    if (me.hand.length === 0) {
      this.session.passMain();
      return;
    }
    let bestId = me.hand[0].id;
    let bestScore = -Infinity;
    for (const c of me.hand) {
      const s = this.scorePlay(state, c);
      if (s > bestScore) {
        bestScore = s;
        bestId = c.id;
      }
    }
    if (bestScore < -1000) {
      this.session.passMain();
    } else {
      this.session.playCard(bestId);
    }
  }

  private scorePlay(state: GameState, card: LandCard): number {
    const me = state.players[this.seat];
    const counts = countInPlay(me.inPlay);
    const after = { ...counts };
    after[card.type] = (after[card.type] ?? 0) + 1;

    // Winning move trumps everything.
    if (after[card.type] >= 5) return 10_000;
    if (LAND_TYPES.every((t) => after[t] >= 1)) return 10_000;

    let score = 0;
    // Closer to 5-of-a-kind = better, weighted higher near completion.
    score += after[card.type] * after[card.type];
    // Reward filling a fresh type if we have most other types already.
    const missing = LAND_TYPES.filter((t) => after[t] === 0).length;
    if (missing <= 2 && counts[card.type] === 0) score += 4;

    // Effect utility on top.
    score += this.effectUtility(state, card);
    return score;
  }

  private effectUtility(state: GameState, card: LandCard): number {
    const opp = state.players[this.seat === 0 ? 1 : 0];
    const me = state.players[this.seat];
    const myDiscard = me.discard;
    switch (card.type) {
      case "plains":
        return 2; // Card draw is reliably useful.
      case "mountain": {
        if (opp.inPlay.length === 0) return -1; // fizzles
        const oppCounts = countInPlay(opp.inPlay);
        const oppMax = Math.max(...LAND_TYPES.map((t) => oppCounts[t] ?? 0));
        if (oppMax >= 4) return 8; // urgent
        if (oppMax >= 3) return 4;
        return 2;
      }
      case "swamp":
        return opp.hand.length === 0 ? -1 : 2;
      case "forest":
        return myDiscard.length === 0 ? -1 : 3;
      case "island":
        return me.deck.length === 0 ? -1 : 1;
    }
  }

  // ── Counter window: counter if it stops a win or near-win. ──

  private takeCounter(state: GameState) {
    if (!state.pending) {
      this.session.declineCounter();
      return;
    }
    const me = state.players[this.seat];
    const opts = countersAvailable(me.hand, state.pending.card.type);
    if (opts.length === 0) {
      this.session.declineCounter();
      return;
    }
    const oppAfter = countInPlay(state.players[state.pending.player].inPlay);
    oppAfter[state.pending.card.type] = (oppAfter[state.pending.card.type] ?? 0) + 1;
    const wouldWin =
      oppAfter[state.pending.card.type] >= 5 ||
      LAND_TYPES.every((t) => oppAfter[t] >= 1);
    if (!wouldWin) {
      // Also counter if it would be opponent's 4th of a type (forces extra
      // pressure) — but only if we have spare resources.
      const closeToFive =
        oppAfter[state.pending.card.type] >= 4 && me.hand.length >= 5;
      if (!closeToFive) {
        this.session.declineCounter();
        return;
      }
    }
    // Use the cheapest pair (the first works).
    const pick = opts[0];
    this.session.counter(pick.island.id, pick.match.id);
  }

  // ── Effect resolution helpers ──

  private takeMountain(state: GameState) {
    const opp = state.players[this.seat === 0 ? 1 : 0];
    if (opp.inPlay.length === 0) return;
    // Destroy the type opponent has most of (closest to 5-of-a-kind).
    const counts = countInPlay(opp.inPlay);
    let bestType: LandType = opp.inPlay[0].type;
    for (const t of LAND_TYPES) {
      if ((counts[t] ?? 0) > (counts[bestType] ?? 0)) bestType = t;
    }
    const target = opp.inPlay.find((c) => c.type === bestType) ?? opp.inPlay[0];
    this.session.resolveMountain(target.id);
  }

  private takeSwamp(state: GameState) {
    const opp = state.players[this.seat === 0 ? 1 : 0];
    if (opp.hand.length === 0) return;
    // Discard their most-frequent hand type (kneecaps 5-of-a-kind progress).
    const handCounts = countInPlay(opp.hand);
    let bestType: LandType = opp.hand[0].type;
    for (const t of LAND_TYPES) {
      if ((handCounts[t] ?? 0) > (handCounts[bestType] ?? 0)) bestType = t;
    }
    const target = opp.hand.find((c) => c.type === bestType) ?? opp.hand[0];
    this.session.resolveSwamp(target.id);
  }

  private takeForest(state: GameState) {
    const me = state.players[this.seat];
    if (me.discard.length === 0) return;
    // Return a type we want most for our current plan.
    const counts = countInPlay(me.inPlay);
    // If we're going for 5-of-a-kind on type T (counts[T] >= 2), grab that.
    let bestType: LandType = me.discard[0].type;
    let bestScore = -Infinity;
    for (const c of me.discard) {
      const cur = counts[c.type] ?? 0;
      let s = cur * cur; // lean into our biggest stack
      if (cur === 0) s += 2; // also OK for filling missing types
      if (c.type === "island") s += 1; // counters are useful too
      if (s > bestScore) {
        bestScore = s;
        bestType = c.type;
      }
    }
    const target = me.discard.find((c) => c.type === bestType) ?? me.discard[0];
    this.session.resolveForest(target.id);
  }

  private takeIsland(state: GameState) {
    if (!state.islandScry) return;
    const me = state.players[this.seat];
    const counts = countInPlay(me.inPlay);
    // Score each revealed card by how much we want it next. Keep top 2-3,
    // discard duplicates of types we have many copies of (already in play +
    // already in hand).
    const handCounts = countInPlay(me.hand);
    const scored = state.islandScry.revealed.map((c) => {
      const inPlay = counts[c.type] ?? 0;
      const inHand = handCounts[c.type] ?? 0;
      // Prefer cards that complete what we already have in play.
      let s = inPlay * 3;
      // But if we already have plenty in hand, marginal value drops.
      s -= inHand;
      // Slight bias toward keeping Islands (counter fodder).
      if (c.type === "island") s += 0.5;
      return { card: c, score: s };
    });
    scored.sort((a, b) => b.score - a.score);
    // Keep top 2 if we have a clear stack focus, else keep all.
    const keepCount = Math.min(scored.length, 3);
    const keep = scored.slice(0, keepCount);
    const dump = scored.slice(keepCount);
    this.session.resolveIsland(
      dump.map((s) => s.card.id),
      keep.map((s) => s.card.id),
    );
  }
}

// ── Pure helpers ──

function countInPlay(cards: LandCard[]): Record<LandType, number> {
  const out: Record<LandType, number> = {
    plains: 0,
    island: 0,
    swamp: 0,
    mountain: 0,
    forest: 0,
  };
  for (const c of cards) out[c.type]++;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// RandomLandsBot — uniform random over legal decisions.
// Used by the "side project" simple play-vs-bot mode.
// ─────────────────────────────────────────────────────────────────────────────

export class RandomLandsBot implements ILandsBot {
  private readonly session: LandsSession;
  readonly seat: 0 | 1;
  private readonly rng: () => number;

  constructor(session: LandsSession, seat: 0 | 1, rng: () => number = Math.random) {
    this.session = session;
    this.seat = seat;
    this.rng = rng;
  }

  step(state: GameState): boolean {
    if (state.phase === "game_over") return false;

    if (state.phase === "main" && state.activePlayer === this.seat) {
      this.takeMain(state);
      return true;
    }
    if (state.phase === "counter_window" && state.activePlayer !== this.seat) {
      this.takeCounter(state);
      return true;
    }
    if (state.activePlayer !== this.seat) return false;

    switch (state.phase) {
      case "mountain_target":
        this.pickRandomMountain(state);
        return true;
      case "swamp_view":
        this.pickRandomSwamp(state);
        return true;
      case "forest_pick":
        this.pickRandomForest(state);
        return true;
      case "island_scry":
        this.resolveRandomIsland(state);
        return true;
    }
    return false;
  }

  private pick<T>(xs: T[]): T {
    return xs[Math.floor(this.rng() * xs.length)];
  }

  private takeMain(state: GameState) {
    const me = state.players[this.seat];
    // Never pass voluntarily — wasting a turn is strictly worse than playing
    // a fizzling land. Only pass if the hand is genuinely empty (no legal
    // play exists).
    if (me.hand.length === 0) {
      this.session.passMain();
      return;
    }
    this.session.playCard(this.pick(me.hand).id);
  }

  private takeCounter(_state: GameState) {
    // The Box never counters — it just shrugs and lets plays through. Makes
    // for a more chaotic early-game opponent that doesn't burn its Islands.
    this.session.declineCounter();
  }

  private pickRandomMountain(state: GameState) {
    const opp = state.players[this.seat === 0 ? 1 : 0];
    if (opp.inPlay.length === 0) return;
    this.session.resolveMountain(this.pick(opp.inPlay).id);
  }

  private pickRandomSwamp(state: GameState) {
    const opp = state.players[this.seat === 0 ? 1 : 0];
    if (opp.hand.length === 0) return;
    this.session.resolveSwamp(this.pick(opp.hand).id);
  }

  private pickRandomForest(state: GameState) {
    const me = state.players[this.seat];
    if (me.discard.length === 0) return;
    this.session.resolveForest(this.pick(me.discard).id);
  }

  private resolveRandomIsland(state: GameState) {
    if (!state.islandScry) return;
    const ids = state.islandScry.revealed.map((c) => c.id);
    // For each card flip a coin: discard or keep. Keep order is shuffled.
    const discard: number[] = [];
    const keep: number[] = [];
    for (const id of ids) (this.rng() < 0.5 ? discard : keep).push(id);
    // Shuffle keep order.
    for (let i = keep.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [keep[i], keep[j]] = [keep[j], keep[i]];
    }
    this.session.resolveIsland(discard, keep);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FlowchartLandsBot — Twonky-style priority flowchart, no scoring.
//
// Decision tree (in order; first match wins):
//   1. If a hand card would WIN immediately (5-of-a-kind or rainbow), play it.
//   2. Early game (fewer than 2 lands in play): play Plains, else Swamp.
//   3. Mid+ game: play a missing-type land (preferred order: Plains, Swamp,
//      Mountain, Forest, Island). Skip cards that would fizzle.
//   4. Dig: play Island to scry, or Forest to retrieve, or Plains to draw.
//   5. Otherwise pass.
//
// Targeting / resolution rules:
//   - Mountain destroys the in-play type the opponent has *fewest* of across
//     their visible cards (in-play + revealed hand). Disrupts rainbow progress.
//   - Swamp discards from opponent's hand the card whose type they have
//     *fewest* visible copies of. Same rationale.
//   - Forest retrieves a card whose type we currently have zero of in hand or
//     play — i.e. dig for missing types. Falls back to Island, then anything.
//   - Island scry: discard any revealed card whose type we already have a copy
//     of (hand or play); keep unique types on top.
//   - Counter only when the opponent's pending play would complete their win.
// ─────────────────────────────────────────────────────────────────────────────

const PLAY_PRIORITY: LandType[] = ["plains", "swamp", "mountain", "forest", "island"];

export class FlowchartLandsBot implements ILandsBot {
  private readonly session: LandsSession;
  readonly seat: 0 | 1;

  constructor(session: LandsSession, seat: 0 | 1) {
    this.session = session;
    this.seat = seat;
  }

  step(state: GameState): boolean {
    if (state.phase === "game_over") return false;

    if (state.phase === "main" && state.activePlayer === this.seat) {
      this.takeMain(state);
      return true;
    }
    if (state.phase === "counter_window" && state.activePlayer !== this.seat) {
      this.takeCounter(state);
      return true;
    }
    if (state.activePlayer !== this.seat) return false;

    switch (state.phase) {
      case "mountain_target":
        this.takeMountain(state);
        return true;
      case "swamp_view":
        this.takeSwamp(state);
        return true;
      case "forest_pick":
        this.takeForest(state);
        return true;
      case "island_scry":
        this.takeIsland(state);
        return true;
    }
    return false;
  }

  // ── Main step: flowchart ──

  private takeMain(state: GameState) {
    const me = state.players[this.seat];
    if (me.hand.length === 0) {
      this.session.passMain();
      return;
    }

    // 1. Winning play.
    const winCard = this.findWinningCard(state);
    if (winCard) {
      this.session.playCard(winCard.id);
      return;
    }

    // 2. Early game: Plains, then Swamp.
    if (me.inPlay.length < 2) {
      const plains = me.hand.find((c) => c.type === "plains");
      if (plains) {
        this.session.playCard(plains.id);
        return;
      }
      const opp = state.players[this.seat === 0 ? 1 : 0];
      if (opp.hand.length > 0) {
        const swamp = me.hand.find((c) => c.type === "swamp");
        if (swamp) {
          this.session.playCard(swamp.id);
          return;
        }
      }
    }

    // 3. Mid+ game: play a missing-type land we have in hand.
    const inPlayCounts = countInPlay(me.inPlay);
    for (const t of PLAY_PRIORITY) {
      if (inPlayCounts[t] > 0) continue; // not missing
      const card = me.hand.find((c) => c.type === t);
      if (!card) continue;
      if (this.wouldFizzle(state, card)) continue;
      this.session.playCard(card.id);
      return;
    }

    // 4. Dig: Island scry, Forest retrieve, or Plains draw.
    const island = me.hand.find((c) => c.type === "island");
    if (island && !this.wouldFizzle(state, island)) {
      this.session.playCard(island.id);
      return;
    }
    const forest = me.hand.find((c) => c.type === "forest");
    if (forest && !this.wouldFizzle(state, forest)) {
      this.session.playCard(forest.id);
      return;
    }
    const plains = me.hand.find((c) => c.type === "plains");
    if (plains) {
      this.session.playCard(plains.id);
      return;
    }

    // 5. Last resort: play anything, even if it fizzles. The bot never
    //    passes voluntarily — wasting a turn is strictly worse than wasting
    //    a card slot, since both players are racing on the same clock.
    const anyUseful = me.hand.find((c) => !this.wouldFizzle(state, c));
    this.session.playCard((anyUseful ?? me.hand[0]).id);
  }

  // ── Counter: only when the play would complete the opponent's win. ──

  private takeCounter(state: GameState) {
    if (!state.pending) {
      this.session.declineCounter();
      return;
    }
    const me = state.players[this.seat];
    const opts = countersAvailable(me.hand, state.pending.card.type);
    if (opts.length === 0) {
      this.session.declineCounter();
      return;
    }
    const oppIdx = state.pending.player;
    const oppCounts = countInPlay(state.players[oppIdx].inPlay);
    const after = { ...oppCounts };
    after[state.pending.card.type] = (after[state.pending.card.type] ?? 0) + 1;
    const wouldWin =
      after[state.pending.card.type] >= 5 ||
      LAND_TYPES.every((t) => after[t] >= 1);
    if (!wouldWin) {
      this.session.declineCounter();
      return;
    }
    const pick = opts[0];
    this.session.counter(pick.island.id, pick.match.id);
  }

  // ── Mountain: target the type opp has fewest of (visible). ──

  private takeMountain(state: GameState) {
    const opp = state.players[this.seat === 0 ? 1 : 0];
    if (opp.inPlay.length === 0) return;
    const visible = oppVisibleCounts(opp);
    let bestCard = opp.inPlay[0];
    let bestCount = Infinity;
    for (const c of opp.inPlay) {
      const n = visible[c.type];
      if (n < bestCount) {
        bestCount = n;
        bestCard = c;
      }
    }
    this.session.resolveMountain(bestCard.id);
  }

  // ── Swamp: discard the card whose type opp has fewest visible copies of. ──

  private takeSwamp(state: GameState) {
    const opp = state.players[this.seat === 0 ? 1 : 0];
    if (opp.hand.length === 0) return;
    const visible = oppVisibleCounts(opp);
    let bestCard = opp.hand[0];
    let bestCount = Infinity;
    for (const c of opp.hand) {
      const n = visible[c.type];
      if (n < bestCount) {
        bestCount = n;
        bestCard = c;
      }
    }
    this.session.resolveSwamp(bestCard.id);
  }

  // ── Forest: dig for a missing type. ──

  private takeForest(state: GameState) {
    const me = state.players[this.seat];
    if (me.discard.length === 0) return;
    const inPlayCounts = countInPlay(me.inPlay);
    const handCounts = countInPlay(me.hand);
    // Prefer types we have zero of in hand + play.
    const pick =
      me.discard.find(
        (c) => (inPlayCounts[c.type] ?? 0) + (handCounts[c.type] ?? 0) === 0,
      )
      // Otherwise grab an Island (counter fodder)…
      ?? me.discard.find((c) => c.type === "island")
      // …or a type we don't yet have in play…
      ?? me.discard.find((c) => (inPlayCounts[c.type] ?? 0) === 0)
      ?? me.discard[0];
    this.session.resolveForest(pick.id);
  }

  // ── Island: discard duplicates, keep uniques on top. ──

  private takeIsland(state: GameState) {
    if (!state.islandScry) return;
    const me = state.players[this.seat];
    const inPlayCounts = countInPlay(me.inPlay);
    const handCounts = countInPlay(me.hand);
    const seen: Partial<Record<LandType, number>> = {};
    const discardIds: number[] = [];
    const keepIds: number[] = [];
    for (const c of state.islandScry.revealed) {
      const alreadyOwned =
        (inPlayCounts[c.type] ?? 0) + (handCounts[c.type] ?? 0) > 0;
      // Also dedupe within the revealed set itself — if we already plan to
      // keep one Plains off this scry, the next revealed Plains is a duplicate.
      const alreadyKeeping = (seen[c.type] ?? 0) > 0;
      if (alreadyOwned || alreadyKeeping) {
        discardIds.push(c.id);
      } else {
        keepIds.push(c.id);
        seen[c.type] = (seen[c.type] ?? 0) + 1;
      }
    }
    this.session.resolveIsland(discardIds, keepIds);
  }

  // ── Helpers ──

  private findWinningCard(state: GameState): LandCard | null {
    const me = state.players[this.seat];
    const counts = countInPlay(me.inPlay);
    for (const c of me.hand) {
      const after = { ...counts };
      after[c.type] = (after[c.type] ?? 0) + 1;
      if (after[c.type] >= 5) return c;
      if (LAND_TYPES.every((t) => after[t] >= 1)) return c;
    }
    return null;
  }

  /** Cards whose on-play effect has no legal target. Still legal to play, but
   *  the bot avoids these unless there is no better option. */
  private wouldFizzle(state: GameState, c: LandCard): boolean {
    const me = state.players[this.seat];
    const opp = state.players[this.seat === 0 ? 1 : 0];
    switch (c.type) {
      case "mountain":
        return opp.inPlay.length === 0;
      case "forest":
        return me.discard.length === 0;
      case "swamp":
        return opp.hand.length === 0;
      case "island":
        return me.deck.length === 0 && me.discard.length === 0;
      default:
        return false;
    }
  }
}

/** Visible counts of opponent's cards (in-play + cards in their hand that
 *  have been revealed to us, e.g. via a Swamp we played earlier). */
function oppVisibleCounts(opp: PlayerState): Record<LandType, number> {
  const out: Record<LandType, number> = {
    plains: 0,
    island: 0,
    swamp: 0,
    mountain: 0,
    forest: 0,
  };
  for (const c of opp.inPlay) out[c.type]++;
  for (const c of opp.hand) if (c.revealedToOpponent) out[c.type]++;
  return out;
}
