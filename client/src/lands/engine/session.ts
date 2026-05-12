import {
  LAND_TYPES,
  type GameState,
  type LandCard,
  type LandType,
  type LogEntry,
  type PlayerState,
} from "./types";

const INITIAL_HAND_SIZE = 3;
const COPIES_PER_TYPE = 5;

export interface SessionConfig {
  playerNames: [string, string];
  /** Who goes first (0 or 1). Defaults to a coin flip. */
  firstPlayer?: 0 | 1;
  /** Optional seed for deterministic shuffling (defaults to Math.random). */
  rng?: () => number;
  /**
   * When true, the counter window opens whenever the non-active player has
   * ≥2 cards in hand — even if they can't actually counter. This preserves
   * bluff potential in PvP (the opponent never gets free information about
   * whether you held an Island + matching land). Off by default; only the
   * MP path turns it on, since bots wouldn't bluff anyway.
   */
  bluffMode?: boolean;
}

/** Public listener interface — UI subscribes once and re-renders on each emit. */
export type Listener = (state: GameState) => void;

export class LandsSession {
  private state: GameState;
  private listeners = new Set<Listener>();
  private rng: () => number;
  private nextCardId = 1;
  /** Per-seat bluff-mode flags. Held privately on the session so they can be
   *  redacted per-perspective in snapshotFor — each player only sees their
   *  own setting in the snapshot they render. */
  private playerBluffMode: [boolean, boolean];

  constructor(cfg: SessionConfig) {
    this.rng = cfg.rng ?? Math.random;
    // Both seats start at the config default. SP doesn't pass this (so it
    // stays off for both — bots can't bluff anyway). MP passes true.
    this.playerBluffMode = [!!cfg.bluffMode, !!cfg.bluffMode];
    const first = cfg.firstPlayer ?? (this.rng() < 0.5 ? 0 : 1);
    this.state = {
      players: [
        this.makePlayer(cfg.playerNames[0], 0),
        this.makePlayer(cfg.playerNames[1], 1),
      ],
      activePlayer: first,
      turnCount: 1,
      phase: "main",
      pending: null,
      islandScry: null,
      winner: null,
      winReason: null,
      // Placeholder — the real value lives in `playerBluffMode` and is
      // injected per-viewer by snapshotFor. This field is just here to
      // satisfy the GameState type.
      bluffMode: false,
      log: [
        { turn: 0, player: null, text: `${cfg.playerNames[first]} goes first.` },
      ],
    };

    // Opening: each player draws an opening hand, then the first player draws
    // their turn-1 card.
    this.drawN(0, INITIAL_HAND_SIZE);
    this.drawN(1, INITIAL_HAND_SIZE);
    // Log the starting hand per player. Public text shows just the count;
    // ownerText reveals the actual composition to that player in prose
    // ("two Mountains and a Forest" — not "2 mountain, 1 forest").
    for (const idx of [0, 1] as const) {
      const p = this.state.players[idx];
      this.log(
        idx,
        `${p.name} draws their opening hand of ${p.hand.length} cards.`,
        `${p.name}'s opening hand: ${humanizeHandComposition(p.hand)}.`,
      );
    }
    this.beginTurn(/*firstTurn=*/ true);
  }

  // ── Subscriptions ──

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  /**
   * Build a redacted snapshot for a specific viewer seat. Used by the
   * multiplayer host to ship perspective-filtered state to each player:
   *   - the viewer's own hand & deck stay fully visible;
   *   - the opponent's hand has unrevealed cards redacted to a placeholder
   *     type (face-down UI never reads the type, so this is functionally
   *     invisible — it just prevents leak via the DB / dev tools);
   *   - the opponent's deck is fully redacted (count only);
   *   - the Island scry is hidden when it belongs to the opponent;
   *   - log entries' ownerText is stripped for entries the viewer didn't author.
   */
  snapshotFor(viewer: 0 | 1): GameState {
    const snap = this.snapshot();
    for (const idx of [0, 1] as const) {
      if (idx === viewer) continue;
      const p = snap.players[idx];
      p.hand = p.hand.map((c) => redactUnrevealed(c));
      p.deck = p.deck.map((c) => ({ ...c, type: "plains" }));
    }
    if (snap.activePlayer !== viewer) snap.islandScry = null;
    snap.log = snap.log.map((e) =>
      e.ownerText && e.player !== viewer ? { ...e, ownerText: undefined } : e,
    );
    // The viewer only ever sees their own bluffMode value — the opponent's
    // setting stays private to the session.
    snap.bluffMode = this.playerBluffMode[viewer];
    return snap;
  }

  /** The host writes this object to the games row after each state change.
   *  Top-level fields are duplicated from the redacted states so InstantDB
   *  queries can filter/index without parsing the JSON blobs. */
  getDbPayload(version: number): {
    p0State: GameState;
    p1State: GameState;
    phase: string;
    activePlayer: number;
    turnCount: number;
    winner?: number;
    winReason?: string;
    stateVersion: number;
    updatedAt: number;
  } {
    return {
      p0State: this.snapshotFor(0),
      p1State: this.snapshotFor(1),
      phase: this.state.phase,
      activePlayer: this.state.activePlayer,
      turnCount: this.state.turnCount,
      ...(this.state.winner != null ? { winner: this.state.winner } : {}),
      ...(this.state.winReason ? { winReason: this.state.winReason } : {}),
      stateVersion: version,
      updatedAt: Date.now(),
    };
  }

  /** Deep clone for safe external use (UI cannot mutate engine state). */
  snapshot(): GameState {
    return JSON.parse(JSON.stringify(this.state));
  }

  // ── Setup helpers ──

  private makePlayer(name: string, owner: 0 | 1): PlayerState {
    const deck: LandCard[] = [];
    for (const type of LAND_TYPES) {
      for (let i = 0; i < COPIES_PER_TYPE; i++) {
        deck.push({ id: this.nextCardId++, type, owner });
      }
    }
    this.shuffleInPlace(deck);
    return { name, deck, hand: [], inPlay: [], discard: [] };
  }

  private shuffleInPlace<T>(arr: T[]) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // ── Turn lifecycle ──

  private beginTurn(firstTurn = false) {
    const p = this.state.activePlayer;
    if (!firstTurn) {
      this.state.turnCount++;
      // Draw step. Empty deck = no draw (the game will usually end first).
      // First player skips the turn-1 draw — they trade card economy for tempo.
      const drawn = this.drawOne(p);
      if (drawn) {
        const name = this.state.players[p].name;
        // Public text shows "draws a card." — the actor's ownerText reveals
        // the specific type so the active player can see what they drew.
        this.log(
          p,
          `${name} draws a card.`,
          `${name} draws a ${cap(drawn.type)}.`,
        );
      }
    }
    this.state.phase = "main";
    this.checkWinAfterDraw();
  }

  /** Single-card draw with the reshuffle fallback. Returns the drawn card so
   *  callers can log it; null if both deck and discard are empty. */
  private drawOne(playerIdx: 0 | 1): LandCard | null {
    const p = this.state.players[playerIdx];
    if (p.deck.length === 0) {
      this.reshuffleDiscardIntoDeck(playerIdx);
      if (p.deck.length === 0) return null;
    }
    const card = p.deck.shift()!;
    p.hand.push(card);
    return card;
  }

  private endTurn() {
    if (this.state.phase === "game_over") return;
    this.state.activePlayer = this.state.activePlayer === 0 ? 1 : 0;
    this.beginTurn();
  }

  /**
   * Shuffle the player's discard pile into their deck. No-op if discard is
   * empty. Called when a draw or an Island scry would otherwise hit a fully
   * exhausted deck. Logs the event so the player can see what happened.
   */
  private reshuffleDiscardIntoDeck(playerIdx: 0 | 1) {
    const p = this.state.players[playerIdx];
    if (p.discard.length === 0) return;
    const moved = p.discard.length;
    p.deck.push(...p.discard);
    p.discard = [];
    this.shuffleInPlace(p.deck);
    this.log(playerIdx, `${p.name} shuffles ${moved} discard${moved === 1 ? "" : "s"} into the deck.`);
  }

  private drawN(playerIdx: 0 | 1, n: number) {
    const p = this.state.players[playerIdx];
    for (let i = 0; i < n; i++) {
      if (p.deck.length === 0) {
        this.reshuffleDiscardIntoDeck(playerIdx);
        // If discard was also empty, there's genuinely nothing to draw.
        if (p.deck.length === 0) return;
      }
      p.hand.push(p.deck.shift()!);
    }
  }

  // ── Public actions ──

  /** Active player plays a card from hand. */
  playCard(cardId: number) {
    if (this.state.phase !== "main") return;
    const p = this.state.activePlayer;
    const player = this.state.players[p];
    const idx = player.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return;
    const [card] = player.hand.splice(idx, 1);
    this.state.pending = { card, player: p };

    // Cards that target on play (Mountain, Forest) lock in their target BEFORE
    // the counter window, so the counter-deciding opponent can see what's at
    // stake. The play-log line is deferred until the target is known.
    if (card.type === "mountain") {
      this.openMountainTargeting();
    } else if (card.type === "forest") {
      this.openForestTargeting();
    } else {
      // Plains / Swamp / Island: no pre-target. Log the play immediately.
      this.log(p, `${player.name} plays ${cap(card.type)}.`);
      this.moveToCounterOrResolve();
    }
    this.emit();
  }

  /** Pick the Mountain's target (or auto-pick / fizzle), then open the counter
   *  window. Logs the play with the target embedded. */
  private openMountainTargeting() {
    const p = this.state.activePlayer;
    const oppIdx = (p === 0 ? 1 : 0) as 0 | 1;
    const opp = this.state.players[oppIdx];
    const me = this.state.players[p];
    const cardType = this.state.pending!.card.type;
    if (opp.inPlay.length === 0) {
      // Fizzle: no targets. Mountain still plays out (enters play) but does
      // nothing. Logged as a fizzle so the player understands why.
      this.log(p, `${me.name} plays ${cap(cardType)} (no opponent lands to destroy — fizzles).`);
      this.moveToCounterOrResolve();
      return;
    }
    // No choice to make when every target is mechanically identical — auto-
    // pick the first. Covers both "single card" and "multiple of one type".
    if (allSameType(opp.inPlay)) {
      this.state.pending!.target = opp.inPlay[0];
      this.log(
        p,
        `${me.name} plays ${cap(cardType)} to destroy ${opp.name}'s ${cap(opp.inPlay[0].type)}.`,
      );
      this.moveToCounterOrResolve();
      return;
    }
    this.state.phase = "mountain_target";
  }

  private openForestTargeting() {
    const p = this.state.activePlayer;
    const me = this.state.players[p];
    const cardType = this.state.pending!.card.type;
    if (me.discard.length === 0) {
      this.log(p, `${me.name} plays ${cap(cardType)} (discard is empty — fizzles).`);
      this.moveToCounterOrResolve();
      return;
    }
    if (allSameType(me.discard)) {
      this.state.pending!.target = me.discard[0];
      this.log(
        p,
        `${me.name} plays ${cap(cardType)} to retrieve ${cap(me.discard[0].type)} from discard.`,
      );
      this.moveToCounterOrResolve();
      return;
    }
    this.state.phase = "forest_pick";
  }

  /** Open counter window if it's available, otherwise resolve the pending
   *  play directly. Used after the play log is written. */
  private moveToCounterOrResolve() {
    if (this.opponentCanCounter()) {
      this.state.phase = "counter_window";
    } else {
      this.resolvePending();
    }
  }

  /** Active player passes their main step (declines to play a card). */
  passMain() {
    if (this.state.phase !== "main") return;
    this.log(this.state.activePlayer, `${this.activeName()} passes.`);
    this.endTurn();
    this.emit();
  }

  /** Opponent counters the pending play by discarding [islandId, matchingId]. */
  counter(islandCardId: number, matchingCardId: number) {
    if (this.state.phase !== "counter_window" || !this.state.pending) return;
    const opp = (this.state.activePlayer === 0 ? 1 : 0) as 0 | 1;
    const counterer = this.state.players[opp];
    const pending = this.state.pending;

    const islandIdx = counterer.hand.findIndex(
      (c) => c.id === islandCardId && c.type === "island"
    );
    const matchIdx = counterer.hand.findIndex(
      (c) => c.id === matchingCardId && c.type === pending.card.type
    );
    if (islandIdx < 0 || matchIdx < 0 || islandIdx === matchIdx) return;

    // Remove highest index first so the second remove isn't shifted.
    const [a, b] = islandIdx > matchIdx ? [islandIdx, matchIdx] : [matchIdx, islandIdx];
    const [highCard] = counterer.hand.splice(a, 1);
    const [lowCard] = counterer.hand.splice(b, 1);
    counterer.discard.push(highCard, lowCard);

    // The countered card goes to its owner's discard.
    this.state.players[pending.player].discard.push(pending.card);
    const owner = this.state.players[pending.player];
    this.state.pending = null;
    this.log(
      opp,
      `${counterer.name} counters ${owner.name}'s ${cap(pending.card.type)} with Island + ${cap(pending.card.type)}; effect blocked.`,
    );
    this.endTurn();
    this.emit();
  }

  /** Opponent declines to counter — pending play resolves. */
  declineCounter() {
    if (this.state.phase !== "counter_window") return;
    this.resolvePending();
    this.emit();
  }

  // ── Effect resolution ──

  private resolvePending() {
    if (!this.state.pending) {
      this.state.phase = "main";
      return;
    }
    // Capture target before nulling pending — Mountain/Forest need it below.
    const { card, player, target } = this.state.pending;
    // Land enters play first; then its on-play effect resolves.
    this.state.players[player].inPlay.push(card);
    this.state.pending = null;

    // Check win on entering play (5-of-a-kind or all-5 may have completed).
    if (this.checkAndSetWin()) return;

    // Trigger effect. Some require player input → set a phase. Others resolve
    // immediately (or fizzle if no valid targets) and then end the turn.
    const name = this.nameOf(player);
    switch (card.type) {
      case "plains": {
        const drawn = this.drawOne(player);
        if (drawn) {
          // Public log just says "a card"; actor's ownerText reveals the type.
          this.log(
            player,
            `${name} draws a card from Plains.`,
            `${name} draws a ${cap(drawn.type)} from Plains.`,
          );
        } else {
          this.log(player, `${name}'s Plains fizzles — deck and discard are both empty.`);
        }
        this.endTurn();
        return;
      }
      case "mountain": {
        // Target was pre-chosen during the play step (or this is a fizzle).
        if (target) {
          const oppIdx = (player === 0 ? 1 : 0) as 0 | 1;
          const opp = this.state.players[oppIdx];
          const idx = opp.inPlay.findIndex((c) => c.id === target.id);
          if (idx >= 0) {
            const [destroyed] = opp.inPlay.splice(idx, 1);
            opp.discard.push(destroyed);
          }
        }
        // (No log here — the play log already stated the destruction.)
        this.endTurn();
        return;
      }
      case "swamp": {
        const oppIdx = (player === 0 ? 1 : 0) as 0 | 1;
        const oppPlayer = this.state.players[oppIdx];
        const oppHand = oppPlayer.hand;
        if (oppHand.length === 0) {
          this.log(player, `${name}'s Swamp fizzles — opponent's hand is empty.`);
          this.endTurn();
          return;
        }
        // The Swamp player sees every card in opponent's hand. Mark them all
        // as revealed; the UI uses this to keep them face-up afterwards and
        // to flag the owner that their cards are known. Log the reveal here
        // so the log captures the snapshot *before* the discard pick.
        for (const c of oppHand) c.revealedToOpponent = true;
        const revealStr = oppHand.map((c) => cap(c.type)).join(", ");
        this.log(player, `${name}'s Swamp reveals ${oppPlayer.name}'s hand: ${revealStr}.`);
        // Every card in opponent's hand is the same type → no meaningful
        // choice. Auto-pick the first one (covers single-card and "all one
        // type" cases).
        if (allSameType(oppHand)) {
          const removed = oppHand.shift()!;
          oppPlayer.discard.push(removed);
          this.log(player, `${name} discards ${oppPlayer.name}'s ${cap(removed.type)}.`);
          this.endTurn();
          return;
        }
        this.state.phase = "swamp_view";
        return;
      }
      case "forest": {
        if (target) {
          const me = this.state.players[player];
          const idx = me.discard.findIndex((c) => c.id === target.id);
          if (idx >= 0) {
            const [returned] = me.discard.splice(idx, 1);
            me.hand.push(returned);
          }
        }
        // (No log here — the play log already stated the retrieval.)
        this.endTurn();
        return;
      }
      case "island": {
        let deck = this.state.players[player].deck;
        // Island with <4 cards in deck reveals only those — UNLESS the deck
        // is fully empty, in which case the discard reshuffles into the deck
        // first (mirrors the standard draw-from-empty rule). After reshuffle,
        // a still-empty deck means there were no cards anywhere, and the
        // Island fizzles.
        if (deck.length === 0) {
          this.reshuffleDiscardIntoDeck(player);
          deck = this.state.players[player].deck;
          if (deck.length === 0) {
            this.log(player, `${name}'s Island fizzles — deck and discard are both empty.`);
            this.endTurn();
            return;
          }
        }
        const revealCount = Math.min(4, deck.length);
        const revealed = deck.splice(0, revealCount);
        this.state.islandScry = { revealed };
        this.state.phase = "island_scry";
        return;
      }
    }
  }

  /** Lock in the Mountain's target (pre-counter-window). The actual
   *  destruction happens later in `resolvePending`. */
  resolveMountain(targetCardId: number) {
    if (this.state.phase !== "mountain_target" || !this.state.pending) return;
    const p = this.state.activePlayer;
    const oppIdx = (p === 0 ? 1 : 0) as 0 | 1;
    const opp = this.state.players[oppIdx];
    const target = opp.inPlay.find((c) => c.id === targetCardId);
    if (!target) return;
    this.state.pending.target = target;
    this.log(
      p,
      `${this.activeName()} plays ${cap(this.state.pending.card.type)} to destroy ${opp.name}'s ${cap(target.type)}.`,
    );
    this.moveToCounterOrResolve();
    this.emit();
  }

  /** Resolve a Swamp: discard one card from opponent's hand. */
  resolveSwamp(targetCardId: number) {
    if (this.state.phase !== "swamp_view") return;
    const oppIdx = (this.state.activePlayer === 0 ? 1 : 0) as 0 | 1;
    const opp = this.state.players[oppIdx];
    const idx = opp.hand.findIndex((c) => c.id === targetCardId);
    if (idx < 0) return;
    const [discarded] = opp.hand.splice(idx, 1);
    opp.discard.push(discarded);
    this.log(
      this.state.activePlayer,
      `${this.activeName()} discards ${opp.name}'s ${cap(discarded.type)}.`,
    );
    this.endTurn();
    this.emit();
  }

  /** Lock in the Forest's target (pre-counter-window). The actual retrieval
   *  happens later in `resolvePending`. */
  resolveForest(cardId: number) {
    if (this.state.phase !== "forest_pick" || !this.state.pending) return;
    const p = this.state.activePlayer;
    const me = this.state.players[p];
    const target = me.discard.find((c) => c.id === cardId);
    if (!target) return;
    this.state.pending.target = target;
    this.log(
      p,
      `${me.name} plays ${cap(this.state.pending.card.type)} to retrieve ${cap(target.type)} from discard.`,
    );
    this.moveToCounterOrResolve();
    this.emit();
  }

  /**
   * Resolve an Island scry. `discardIds` = cards to send to discard.
   * `topOrderIds` = remaining cards in the order they should be on top of the
   * deck (first in array = top, drawn next). The two lists together must
   * cover exactly the revealed set.
   */
  resolveIsland(discardIds: number[], topOrderIds: number[]) {
    if (this.state.phase !== "island_scry" || !this.state.islandScry) return;
    const revealed = this.state.islandScry.revealed;
    const allIds = new Set(revealed.map((c) => c.id));
    const cover = new Set([...discardIds, ...topOrderIds]);
    if (
      cover.size !== revealed.length ||
      [...allIds].some((id) => !cover.has(id))
    ) {
      // Invalid input — ignore.
      return;
    }

    const byId = new Map(revealed.map((c) => [c.id, c]));
    const p = this.state.activePlayer;
    const me = this.state.players[p];

    const discardedCards: LandCard[] = [];
    for (const id of discardIds) {
      const c = byId.get(id);
      if (c) {
        me.discard.push(c);
        discardedCards.push(c);
      }
    }
    // topOrderIds: first becomes the new top.
    const topAdds: LandCard[] = [];
    for (const id of topOrderIds) {
      const c = byId.get(id);
      if (c) topAdds.push(c);
    }
    me.deck.unshift(...topAdds);

    const keepStr = topAdds.length
      ? topAdds.map((c) => cap(c.type)).join(", ")
      : "none";
    const dumpStr = discardedCards.length
      ? discardedCards.map((c) => cap(c.type)).join(", ")
      : "none";
    // The kept-cards stay hidden (back on top of deck) — only the actor sees
    // which specific cards they kept. The opponent only sees the count.
    const publicText = `${me.name}'s Island: keeps ${topAdds.length} on top; discards ${dumpStr}.`;
    const ownerText = `${me.name}'s Island: keeps ${keepStr} on top; discards ${dumpStr}.`;
    this.log(p, publicText, ownerText);
    this.state.islandScry = null;
    this.endTurn();
    this.emit();
  }

  // ── Win conditions ──

  private countByType(p: PlayerState): Record<LandType, number> {
    const counts: Record<LandType, number> = {
      plains: 0,
      island: 0,
      swamp: 0,
      mountain: 0,
      forest: 0,
    };
    for (const c of p.inPlay) counts[c.type]++;
    return counts;
  }

  private winState(p: PlayerState): { won: boolean; reason: string | null } {
    const counts = this.countByType(p);
    const types = Object.values(counts);
    if (types.every((n) => n >= 1)) {
      return { won: true, reason: "assembled all 5 land types in play" };
    }
    for (const t of LAND_TYPES) {
      if (counts[t] >= 5) {
        return { won: true, reason: `assembled 5 ${cap(t)}s in play` };
      }
    }
    return { won: false, reason: null };
  }

  private checkAndSetWin(): boolean {
    for (const p of [0, 1] as const) {
      const { won, reason } = this.winState(this.state.players[p]);
      if (won) {
        this.state.winner = p;
        this.state.winReason = reason;
        this.state.phase = "game_over";
        this.log(p, `${this.state.players[p].name} wins — ${reason}.`);
        return true;
      }
    }
    return false;
  }

  /** Special: after drawing a card, no zone changes happen but check anyway
   *  in case a future variant ever wins from hand size. (Currently a no-op.) */
  private checkWinAfterDraw() {
    // Currently no win-from-draw condition; intentionally empty.
  }

  // ── Counter window: open if the opponent could counter, OR (in bluff mode)
  //    if they merely *might* be holding a counter — i.e. they have ≥2 cards
  //    in hand. The two-card threshold matches the minimum cost of a real
  //    counter (Island + matching land), so anything less is unambiguous and
  //    the modal would be pure friction.

  private opponentCanCounter(): boolean {
    if (!this.state.pending) return false;
    const opp = (this.state.activePlayer === 0 ? 1 : 0) as 0 | 1;
    const oppHand = this.state.players[opp].hand;
    if (
      countersAvailable(oppHand, this.state.pending.card.type).length > 0
    ) {
      return true;
    }
    // Bluff: the would-be-counterer's *own* setting controls whether the
    // window still opens. Their hand size has to be at least 2 (minimum
    // cost of a real counter pair) for the bluff to be plausible.
    return this.playerBluffMode[opp] && oppHand.length >= 2;
  }

  /** Toggle a single seat's bluff-mode setting. The other seat is untouched
   *  and the change is never logged — bluff state is private to the player
   *  who set it. */
  setBluffMode(seat: 0 | 1, on: boolean) {
    if (this.playerBluffMode[seat] === on) return;
    this.playerBluffMode[seat] = on;
    this.emit();
  }

  // ── Log helpers ──

  private log(player: 0 | 1 | null, text: string, ownerText?: string) {
    const entry: LogEntry = {
      turn: this.state.turnCount,
      player,
      text,
      ownerText,
    };
    this.state.log.push(entry);
  }

  private nameOf(p: 0 | 1) {
    return this.state.players[p].name;
  }
  private activeName() {
    return this.nameOf(this.state.activePlayer);
  }
}

// ── Pure helpers ──

/** Number words for small counts; falls through to a digit string for larger
 *  values. Hand sizes rarely exceed 20 in this game, so the lookup covers
 *  every realistic case. */
const NUMBER_WORDS: Record<number, string> = {
  2: "two", 3: "three", 4: "four", 5: "five",
  6: "six", 7: "seven", 8: "eight", 9: "nine",
  10: "ten", 11: "eleven", 12: "twelve", 13: "thirteen",
  14: "fourteen", 15: "fifteen", 16: "sixteen", 17: "seventeen",
  18: "eighteen", 19: "nineteen", 20: "twenty",
};

function humanizeCount(n: number, type: LandType): string {
  if (n === 1) {
    // "an Island" / "a Mountain" — Island is the only vowel-initial type.
    const article = type === "island" ? "an" : "a";
    return `${article} ${cap(type)}`;
  }
  // Plains is invariant (singular and plural both "Plains").
  const plural = type === "plains" ? cap(type) : `${cap(type)}s`;
  const num = NUMBER_WORDS[n] ?? String(n);
  return `${num} ${plural}`;
}

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return "nothing";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** "two Mountains and a Forest" / "a Mountain, a Plains, and a Forest". */
function humanizeHandComposition(cards: LandCard[]): string {
  const parts: string[] = [];
  for (const t of LAND_TYPES) {
    const n = cards.filter((c) => c.type === t).length;
    if (n > 0) parts.push(humanizeCount(n, t));
  }
  return joinWithAnd(parts);
}

/** Replace a card's type with a placeholder if the opponent hasn't seen it.
 *  The UI never reads `type` on face-down cards, so this is functionally
 *  invisible — its job is to prevent leakage through the DB / dev tools. */
function redactUnrevealed(c: LandCard): LandCard {
  if (c.revealedToOpponent) return c;
  return { ...c, type: "plains" };
}

/** Are every card in this pile the same land type? Used to short-circuit
 *  target-pick prompts when there's no meaningful choice (e.g. opponent has
 *  three Plains in play — picking any one to destroy is equivalent). */
function allSameType(cards: LandCard[]): boolean {
  if (cards.length === 0) return false;
  const t = cards[0].type;
  return cards.every((c) => c.type === t);
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Return all valid counter pairings — [islandCard, matchingCard] tuples —
 * a player could use to counter a given played-card type from their hand.
 * Public so the UI can show which combos are legal.
 */
export function countersAvailable(
  hand: LandCard[],
  playedType: LandType
): Array<{ island: LandCard; match: LandCard }> {
  const islands = hand.filter((c) => c.type === "island");
  const matches = hand.filter((c) => c.type === playedType);
  const out: Array<{ island: LandCard; match: LandCard }> = [];
  for (const i of islands) {
    for (const m of matches) {
      if (i.id === m.id) continue; // can't reuse the same physical card
      out.push({ island: i, match: m });
    }
  }
  return out;
}
