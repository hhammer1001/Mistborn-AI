/**
 * GameSession: unified session that handles both single-player (human vs bot)
 * and multiplayer (human vs human) games.
 *
 * The session tracks an `activePlayer` index at all times. When the active
 * player is a bot, the session auto-runs their turn. When it's a human, the
 * session waits for `playAction()` / `respondToPrompt()` / etc. calls.
 *
 * This replaces the previous split between `GameSession` (single-player) and
 * `MultiplayerGameSession` which duplicated most of this logic and drifted
 * apart for bug fixes.
 */

import { Game, type PlayerFactory } from "./game";
import { Action, Ally, Card, Funding } from "./card";
import { Player } from "./player";
import { WebPlayer } from "./webPlayer";
import { Twonky } from "./bot";
import { SquashBot } from "./squashBot";
import { ZoomBot } from "./zoomBot";
import { SquashV2Bot } from "./squashV2Bot";
import { createHulkX90 } from "./hulkX90Bot";
import { SynergyBotPrime } from "./synergyBot";
import { RandomBot } from "./randomBot";
import { PromptNeeded } from "./prompt";
import type { GameActionInternal } from "./types";
import { METAL_NAMES } from "./types";

// ── Player kinds ──

export type PlayerKind = "human" | "bot_twonky" | "bot_squash" | "bot_squashV2" | "bot_zoom" | "bot_hulk" | "bot_synergy" | "bot_random";

export interface PlayerConfig {
  kind: PlayerKind;
  name: string;
  character: string;
}

function makePlayerFactory(kind: PlayerKind): PlayerFactory {
  switch (kind) {
    case "human":
      return (deck, game, to, name, char) => new WebPlayer(deck, game, to, name, char);
    case "bot_squash":
      return (deck, game, to, name, char) => new SquashBot(deck, game, to, name, char);
    case "bot_squashV2":
      return (deck, game, to, name, char) => new SquashV2Bot(deck, game, to, name, char);
    case "bot_zoom":
      return (deck, game, to, name, char) => new ZoomBot(deck, game, to, name, char);
    case "bot_hulk":
      // Composite: SquashV2 in seat 0, Zoom in seat 1. Picks best-known
      // specialist for each seat → strongest overall bot.
      return (deck, game, to, name, char) => createHulkX90(deck, game, to, name, char);
    case "bot_synergy":
      return (deck, game, to, name, char) => new SynergyBotPrime(deck, game, to, name, char);
    case "bot_random":
      return (deck, game, to, name, char) => new RandomBot(deck, game, to, name, char);
    case "bot_twonky":
    default:
      return (deck, game, to, name, char) => new Twonky(deck, game, to, name, char);
  }
}

/** Map the legacy opponentType strings from the UI to a PlayerKind. */
export function opponentTypeToKind(opponentType: string): PlayerKind {
  if (opponentType === "squash") return "bot_squash";
  if (opponentType === "squashV2") return "bot_squashV2";
  if (opponentType === "zoom") return "bot_zoom";
  if (opponentType === "hulk") return "bot_hulk";
  if (opponentType === "synergy") return "bot_synergy";
  if (opponentType === "random") return "bot_random";
  return "bot_twonky";
}

// ── Full engine-state snapshot for prompt rollback & undo ──

interface PlayerSnapshot {
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
  senseFlag: boolean | null;
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

interface GameSnapshot {
  winnerIndex: number | null;
  victoryType: string;
  turncount: number;
  missionRanks: number[][];
  missionTopReachedBy: (number | null)[];
  marketHand: number[];
  marketCards: number[];
  marketDiscard: number[];
  players: PlayerSnapshot[];
  cardStates: Map<number, CardStateSnap>;
  hiddenCardIds: Set<number>;
  /** Log lengths at snapshot time — used by undo to trim any entries that
   *  were appended during the action(s) being rolled back. Works for
   *  single actions and composite (multi-step) actions alike. */
  logLengths: [number, number];
  /** Length of the structured action-event log at snapshot time. Undo trims
   *  the action log back to this so undone moves are not persisted. */
  actionEventsLength: number;
  /** Pending deck/damage/mission events captured at snapshot time. Restored
   *  on rollback so events emitted by a partial action (e.g. one that threw
   *  PromptNeeded mid-way) don't leak into the activity log after restore. */
  deckEvents: Game["deckEvents"];
  /** Optional bookkeeping value the caller can attach to a snapshot via
   *  `setNextSnapshotData`. Used by the hook to record its own pre-action
   *  log length so undo can roll back UI state alongside engine state. */
  externalData?: number;
  /** True if the action that LEFT this state revealed previously-hidden
   *  information (drew a card, refilled the market, blocked with sense, etc.).
   *  When the snapshot sits on top of the undo stack, this flag gates undo:
   *  reversing a revealing action would un-reveal info the player has already
   *  seen, so canUndo returns false. Per-action — earlier dirty actions don't
   *  block undo of later clean ones. */
  dirty?: boolean;
}

// ── Snapshot helpers for effect logging ──

interface PSnap {
  damage: number; money: number; health: number; mission: number;
  training: number; atium: number; burns: number; handSize: number;
  pDamage: number; pMoney: number; hand_count: number; allies: string[];
}

function psnap(p: Player): PSnap {
  return {
    damage: p.curDamage, money: p.curMoney, health: p.curHealth,
    mission: p.curMission, training: p.training, atium: p.atium,
    burns: p.burns, handSize: p.handSize, pDamage: p.pDamage,
    pMoney: p.pMoney, hand_count: p.deck.hand.length,
    allies: p.allies.map((a) => a.name),
  };
}

function diffToText(before: PSnap, after: PSnap): string[] {
  const parts: string[] = [];
  const diffs: [keyof PSnap, string][] = [
    ["damage", "damage"], ["money", "money"], ["health", "heal"],
    ["mission", "mission"], ["training", "training"], ["atium", "atium"],
    ["burns", "burns"], ["handSize", "+hand size"],
    ["pDamage", "+perm damage"], ["pMoney", "+perm money"],
  ];
  for (const [key, label] of diffs) {
    const delta = (after[key] as number) - (before[key] as number);
    if (delta > 0) parts.push(`+${delta} ${label}`);
    else if (delta < 0) parts.push(`${delta} ${label}`);
  }
  const drawDelta = after.hand_count - before.hand_count;
  if (drawDelta > 0) parts.push(`drew ${drawDelta}`);
  const newAllies = after.allies.filter((n) => !before.allies.includes(n));
  for (const n of newAllies) parts.push(`played ${n}`);
  return parts;
}

import type { CardData } from "../types/game";
interface LogEntry { turn: number; text: string; card?: CardData; cards?: CardData[]; actionType?: string; metalIndex?: number }

// ── Structured action log (for replay + post-game review) ──

/** Bot-decision metadata attached to an event when the actor was a bot.
 *  Captures the chosen action's score and the top alternatives the bot
 *  considered, so reviewers can see what was weighed against what. */
export interface ActionAnnotation {
  picked: { score?: number; reason?: string };
  alternatives?: Array<{ description: string; score: number }>;
}

export type ActionEventType =
  | "action"
  | "composite"
  | "prompt"
  | "damage"
  | "sense"
  | "cloud"
  | "advance_all"
  | "forfeit"
  | "bot_action";

/** One structured entry in the action log. Human moves are recorded with
 *  enough information to drive a replay (`type` + `args` map to the session
 *  entry-point that produced them). Bot moves are recorded for review only —
 *  at replay time the bot regenerates them deterministically from the seed. */
export interface ActionEvent {
  type: ActionEventType;
  playerIndex: 0 | 1;
  args: Record<string, unknown>;
  turncount: number;
  timestamp: number;
  annotation?: ActionAnnotation;
}

// ── GameSession ──

export type GamePhase = "actions" | "damage" | "sense_defense" | "cloud_defense" | "awaiting_prompt" | "game_over";

export interface GameSessionOpts {
  players: [PlayerConfig, PlayerConfig];
  firstPlayer?: 0 | 1;
  testDeck?: boolean;
  /** Optional root seed. Omit to auto-generate via Math.random; supply when
   *  reconstructing a recorded match for replay. All RNG streams (market,
   *  per-player initial decks, mid-game shuffles, per-bot exploration) are
   *  derived from this single value via splitSeed. */
  seed?: number;
}

export class GameSession {
  id: string;
  game: Game;
  players: Player[];
  playerKinds: PlayerKind[];
  activePlayer: 0 | 1 = 0;
  /** The player who went first (set at construction, never mutated). */
  firstPlayer: 0 | 1 = 0;
  phase: GamePhase = "actions";

  // Prompt / replay state
  private _pending_prompt: PromptNeeded | null = null;
  private _pending_action_index: number | null = null;
  private _accumulated_responses: [string, number | boolean][] = [];
  private _cached_raw: GameActionInternal[] | null = null;
  private _cloud_damage = 0;
  private _defender_hp_at_turn_start: number | null = null;
  private _next_player_after_sense: 0 | 1 = 0;
  /** Set when an advance_mission is paused mid-dispatch for the defender's
   *  sense decision. resolveSense uses this to resume the original action
   *  after the defender chooses. */
  private _pending_advance_action: GameActionInternal | null = null;
  /** True while resolveSense is driving _attemptAction. The sense_block log
   *  entry is pushed by resolveSense in that case (where we have direct
   *  knowledge of the defender's choice and the card they used), so the
   *  post-detection inside _attemptAction must not push a duplicate. */
  private _resolvingSense = false;

  // Snapshot-based prompt rollback and undo
  private _preActionSnapshot: GameSnapshot | null = null;
  private _undoStack: GameSnapshot[] = [];
  // Optional caller-provided value attached to the next snapshot taken.
  // Cleared on read so successive snapshots don't inherit stale data.
  private _nextSnapshotData: number | null = null;
  private _playerSnapBefore: PSnap | null = null;
  private _missionBefore = 0;
  // For detecting which opponent Sense card was auto-used to block a mission advance.
  private _oppDiscardIdsBefore: Set<number> | null = null;
  // For detecting cards that got eliminated (moved to market trash) during an action.
  private _marketTrashIdsBefore: Set<number> | null = null;
  // Per-player card-id sets snapshotted before an action; used to attribute
  // eliminations to the player who owned the card prior to the action.
  private _playerCardsBefore: [Set<number>, Set<number>] | null = null;
  // Undo-batch: while open, multiple playAction calls collapse to one undo entry.
  private _batchStart: { snapshot: GameSnapshot; stackLen: number } | null = null;

  // Per-player logs (cumulative). Index 0 = player 0, index 1 = player 1.
  private _logs: [LogEntry[], LogEntry[]] = [[], []];
  // Read-pointer into each log for delta consumption (single-player hook use).
  private _logRead: [number, number] = [0, 0];

  // Structured action-event log for replay + post-game review. Append-only
  // during play; trimmed by undo via the snapshot's `actionEventsLength`.
  private _actionEvents: ActionEvent[] = [];

  constructor(opts: GameSessionOpts) {
    this.id = crypto.randomUUID();
    this.playerKinds = [opts.players[0].kind, opts.players[1].kind];

    const factories: [PlayerFactory, PlayerFactory] = [
      makePlayerFactory(this.playerKinds[0]),
      makePlayerFactory(this.playerKinds[1]),
    ];

    this.game = new Game({
      names: [opts.players[0].name, opts.players[1].name],
      chars: [opts.players[0].character, opts.players[1].character],
      playerFactories: factories,
      testDeck: opts.testDeck ?? false,
      seed: opts.seed,
    });
    this.players = this.game.players;

    const first = opts.firstPlayer ?? 0;
    this.firstPlayer = first;
    this.activePlayer = first;
    this.game.turncount = 1;

    // Going-second HP compensation: +2 HP per position past first in the
    // turn order, capped at 40 with overflow becoming a starting boxing.
    // Applied here (not in Player) because Player only knows its seat
    // index, not who actually plays first.
    for (let i = 0; i < this.players.length; i++) {
      const positionInTurnOrder = (i - first + this.players.length) % this.players.length;
      let hp = 36 + 2 * positionInTurnOrder;
      if (hp > 40) {
        this.players[i].curBoxings += hp - 40;
        hp = 40;
      }
      this.players[i].curHealth = hp;
    }

    // Start-of-turn routine for the first player: apply permanent bonuses,
    // play the allies/funding drawn into their initial hand (now pending),
    // then resolve training.
    const p = this.players[first];
    p.curMoney = p.pMoney;
    p.curDamage = p.pDamage;
    this._playPending(first);
    this._resolveTraining(first);

    // If the first player is a bot, run their turn right away.
    if (this._isBot(this.activePlayer)) {
      this._runBotTurn(this.activePlayer);
    }
  }

  private _isBot(i: number): boolean {
    return this.playerKinds[i] !== "human";
  }

  /** Set of every card-id currently owned by a player (deck library + hand +
   *  discard + allies). Used to attribute mid-action eliminations. */
  private _playerCardIdSet(i: number): Set<number> {
    const p = this.players[i];
    const ids = new Set<number>();
    for (const c of p.deck.cards)   ids.add(c.id);
    for (const c of p.deck.hand)    ids.add(c.id);
    for (const c of p.deck.discard) ids.add(c.id);
    for (const c of p.allies)       ids.add(c.id);
    return ids;
  }

  // ── Snapshot / restore ──

  private _takeSnapshot(): GameSnapshot {
    const winner = this.game.winner;
    const players: PlayerSnapshot[] = this.players.map((p) => ({
      curDamage: p.curDamage, curMoney: p.curMoney, curMission: p.curMission,
      curHealth: p.curHealth, curBoxings: p.curBoxings, training: p.training,
      atium: p.atium, burns: p.burns, pDamage: p.pDamage, pMoney: p.pMoney,
      handSize: p.handSize, alive: p.alive, smoking: p.smoking,
      charAbility1: p.charAbility1, charAbility2: p.charAbility2, charAbility3: p.charAbility3,
      metalTokens: [...p.metalTokens],
      metalAvailable: [...p.metalAvailable],
      metalBurned: [...p.metalBurned],
      activeCardId: p._active_card?.id ?? null,
      senseFlag: (p as WebPlayer)._sense_flag ?? null,
      allyIds: p.allies.map((a) => a.id),
      handIds: p.deck.hand.map((c) => c.id),
      deckIds: p.deck.cards.map((c) => c.id),
      discardIds: p.deck.discard.map((c) => c.id),
      setAsideIds: p.deck.setAside.map((c) => c.id),
      eliminatedCardNames: [...p.eliminatedCardNames],
    }));
    const cardStates = new Map<number, CardStateSnap>();
    for (const c of this._allCards()) {
      const s: CardStateSnap = { sought: c.sought, pending: c.pending };
      if (c instanceof Action) { s.burned = c.burned; s.metalUsed = c.metalUsed; }
      else if (c instanceof Ally) {
        s.available1 = c.available1;
        s.available2 = c.available2;
        s.availableRiot = c.availableRiot;
      }
      cardStates.set(c.id, s);
    }
    const externalData = this._nextSnapshotData;
    this._nextSnapshotData = null;
    return {
      winnerIndex: winner ? winner.turnOrder : null,
      victoryType: this.game.victoryType,
      turncount: this.game.turncount,
      missionRanks: this.game.missions.map((m) => [...m.playerRanks]),
      missionTopReachedBy: this.game.missions.map((m) => m.topReachedBy),
      marketHand: this.game.market.hand.map((c) => c.id),
      marketCards: this.game.market.cards.map((c) => c.id),
      marketDiscard: this.game.market.discard.map((c) => c.id),
      players,
      cardStates,
      hiddenCardIds: this._hiddenCardIds(this.activePlayer),
      logLengths: [this._logs[0].length, this._logs[1].length],
      actionEventsLength: this._actionEvents.length,
      deckEvents: this.game.deckEvents.map((e) => ({ ...e })),
      ...(externalData !== null ? { externalData } : {}),
    };
  }

  private _restoreSnapshot(snap: GameSnapshot): void {
    const byId = new Map<number, Card>();
    for (const c of this._allCards()) byId.set(c.id, c);

    this.game.winner = snap.winnerIndex !== null ? this.players[snap.winnerIndex] : null;
    this.game.victoryType = snap.victoryType;
    this.game.turncount = snap.turncount;
    for (let i = 0; i < this.game.missions.length; i++) {
      this.game.missions[i].playerRanks = [...snap.missionRanks[i]];
      this.game.missions[i].topReachedBy = snap.missionTopReachedBy[i] ?? null;
    }
    this.game.market.hand = snap.marketHand.map((id) => byId.get(id)!).filter(Boolean);
    this.game.market.cards = snap.marketCards.map((id) => byId.get(id)!).filter(Boolean);
    this.game.market.discard = snap.marketDiscard.map((id) => byId.get(id)!).filter(Boolean);

    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
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
      if (p instanceof WebPlayer) p._sense_flag = ps.senseFlag;
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
      if (c instanceof Action) { c.burned = s.burned ?? false; c.metalUsed = s.metalUsed ?? 0; }
      else if (c instanceof Ally) {
        c.available1 = s.available1 ?? false;
        c.available2 = s.available2 ?? false;
        c.availableRiot = s.availableRiot ?? false;
      }
    }
    this.game.deckEvents = snap.deckEvents.map((e) => ({ ...e }));
  }

  private _allCards(): Card[] {
    const cards: Card[] = [];
    cards.push(...this.game.market.hand, ...this.game.market.cards, ...this.game.market.discard);
    for (const p of this.players) {
      cards.push(...p.deck.hand, ...p.deck.cards, ...p.deck.discard, ...p.deck.setAside);
      cards.push(...p.allies);
    }
    return cards;
  }

  private _hiddenCardIds(perspective: number): Set<number> {
    const ids = new Set<number>();
    const me = this.players[perspective];
    const opp = this.players[1 - perspective];
    for (const c of me.deck.cards) ids.add(c.id);
    for (const c of opp.deck.hand) ids.add(c.id);
    for (const c of opp.deck.cards) ids.add(c.id);
    for (const c of opp.deck.setAside) ids.add(c.id);
    for (const c of this.game.market.cards) ids.add(c.id);
    return ids;
  }

  private _didRevealInfo(snap: GameSnapshot): boolean {
    const currentHidden = this._hiddenCardIds(this.activePlayer);
    for (const id of snap.hiddenCardIds) {
      if (!currentHidden.has(id)) return true;
    }
    return false;
  }

  // ── Undo ──

  canUndo(): boolean {
    const top = this._undoStack[this._undoStack.length - 1];
    return (
      top !== undefined &&
      !top.dirty &&
      this.phase === "actions" &&
      !this._isBot(this.activePlayer)
    );
  }

  /** Tag the next snapshot taken (by playAction, beginUndoBatch, or
   *  playComposite) with a caller-provided value. Used by the UI hook to
   *  record its own pre-action log length so undo can roll back UI state
   *  alongside engine state. Cleared on read; set fresh each time. */
  setNextSnapshotData(data: number | null): void {
    this._nextSnapshotData = data;
  }

  /** Read the externalData of the snapshot at the top of the undo stack —
   *  i.e. what undo() will restore to. Returns null if the stack is empty
   *  or the top snapshot wasn't tagged. */
  peekUndoData(): number | null {
    const top = this._undoStack[this._undoStack.length - 1];
    return top?.externalData ?? null;
  }

  // ── Structured action log ──

  /** Read-only view of the structured action log. Each entry corresponds to
   *  one external session call (human move) or one bot performAction (bot
   *  move). Persist alongside the seed for replay + post-game review. */
  getActionLog(): readonly ActionEvent[] {
    return this._actionEvents;
  }

  private _pushActionEvent(
    type: ActionEventType,
    playerIndex: number,
    args: Record<string, unknown>,
    annotation?: ActionAnnotation,
  ): void {
    const ev: ActionEvent = {
      type,
      playerIndex: playerIndex as 0 | 1,
      args,
      turncount: this.game.turncount,
      timestamp: Date.now(),
    };
    if (annotation) ev.annotation = annotation;
    this._actionEvents.push(ev);
  }

  /** Open a batch so subsequent playAction calls collapse to one undo entry. */
  beginUndoBatch(): void {
    if (this._batchStart) return;
    this._batchStart = {
      snapshot: this._takeSnapshot(),
      stackLen: this._undoStack.length,
    };
  }

  /** Close the batch opened by beginUndoBatch; collapses pushed entries.
   *  The composite snapshot inherits dirty=true if any inner action revealed
   *  info, so undoing the whole composite is forbidden whenever any of its
   *  steps would unreveal something. */
  endUndoBatch(): void {
    if (!this._batchStart) return;
    const { snapshot, stackLen } = this._batchStart;
    this._batchStart = null;
    let anyDirty = false;
    while (this._undoStack.length > stackLen) {
      const popped = this._undoStack.pop()!;
      if (popped.dirty) anyDirty = true;
    }
    snapshot.dirty = anyDirty;
    this._undoStack.push(snapshot);
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    const snap = this._undoStack.pop()!;
    this._restoreSnapshot(snap);
    // Trim any log entries added since the snapshot was taken. Works for
    // single actions and composite (multi-step) actions uniformly.
    this._logs[0].length = Math.min(this._logs[0].length, snap.logLengths[0]);
    this._logs[1].length = Math.min(this._logs[1].length, snap.logLengths[1]);
    this._logRead[0] = Math.min(this._logRead[0], this._logs[0].length);
    this._logRead[1] = Math.min(this._logRead[1], this._logs[1].length);
    this._actionEvents.length = Math.min(this._actionEvents.length, snap.actionEventsLength);
    this._cached_raw = null;
    return true;
  }

  // ── Action source name (for logs) ──

  private _actionSourceName(action: GameActionInternal, playerIndex: number): string | null {
    const p = this.players[playerIndex];
    switch (action.type) {
      case "burn_card": return `${action.card.name} (burn)`;
      case "use_metal": return `Used ability ${(action.card as Action).metalUsed} of ${action.card.name}`;
      case "burn_metal": return `Burn ${METAL_NAMES[action.metalIndex]}`;
      case "flare_metal": return `Flare ${METAL_NAMES[action.metalIndex]}`;
      case "use_atium": return `Burn atium as ${METAL_NAMES[action.metalIndex]}`;
      case "ally_ability_1": return `${action.card.name} ability 1`;
      case "ally_ability_2": return `${action.card.name} ability 2`;
      case "char_ability_1": return `${p.character} ability I`;
      case "char_ability_3": return `${p.character} ability III`;
      case "buy": return `Bought ${action.card.name} for ${action.card.cost}`;
      case "buy_eliminate": return `Buy+eliminate ${action.card.name}`;
      case "buy_with_boxings": return `Bought ${action.card.name} for ${action.card.cost} (${action.boxingsCost} boxings)`;
      case "buy_elim_boxings": return `Buy+eliminate ${action.card.name} (${action.boxingsCost} boxings)`;
      case "buy_boxing": return "Bought Boxing (2 money → 1 boxing)";
      case "advance_mission": return `Mission ${action.mission.name}`;
      case "refresh_metal": return `Refresh ${METAL_NAMES[action.metalIndex]} with ${action.card.name}`;
      default: return null;
    }
  }

  /** Action methods finish by calling this so the activity log gets the
   *  draws/shuffles that happened along the way before the new state goes
   *  out to clients. */
  private _returnState(playerIndex: number): Record<string, unknown> {
    this._drainDeckEvents();
    return this.getState(playerIndex);
  }

  /** Drain accumulated deck events (ad-hoc draws + reshuffles) into the
   *  per-player activity logs. Called at the end of every public action
   *  method so the log reflects everything the action triggered. */
  private _drainDeckEvents() {
    const turn = this.game.turncount;
    for (const event of this.game.deckEvents) {
      if (event.amount <= 0) continue;
      const owner = event.playerIndex as 0 | 1;
      if (event.type === "draw") {
        const noun = `card${event.amount === 1 ? "" : "s"}`;
        this._logs[owner].push({ turn, text: `Drew ${event.amount} ${noun}` });
        this._logs[1 - owner].push({ turn, text: `Opponent drew ${event.amount} ${noun}` });
      } else if (event.type === "damage") {
        this._logs[owner].push({ turn, text: `Gained ${event.amount} damage` });
        this._logs[1 - owner].push({ turn, text: `Opponent gained ${event.amount} damage` });
      } else if (event.type === "mission") {
        this._logs[owner].push({ turn, text: `Gained ${event.amount} mission` });
        this._logs[1 - owner].push({ turn, text: `Opponent gained ${event.amount} mission` });
      }
    }
    this.game.deckEvents = [];
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.deck.shuffleOccurred) {
        const oi = (1 - i) as 0 | 1;
        this._logs[i].push({ turn, text: "Shuffled deck" });
        this._logs[oi].push({ turn, text: "Opponent shuffled deck" });
        p.deck.shuffleOccurred = false;
      }
    }
  }

  // ── State for clients ──

  getState(perspective: number = this.activePlayer): Record<string, unknown> {
    // Reveal both hands + discards once the game is over so the postgame
    // screen can show each player's full final state.
    const serializePerspective = this.phase === "game_over" ? null : perspective;
    const state: Record<string, unknown> = this.game.toJSON(serializePerspective);
    state["sessionId"] = this.id;
    state["phase"] = this.phase;
    state["activePlayer"] = this.activePlayer;
    state["myPlayerIndex"] = perspective;
    state["isMyTurn"] = this.activePlayer === perspective;
    state["turnCount"] = this.game.turncount;

    if (this.game.winner) {
      const wi = this.game.winner.turnOrder;
      state["isWinner"] = wi === perspective;
    } else {
      state["isWinner"] = false;
    }

    if (this.phase === "actions" && this.activePlayer === perspective) {
      const [serialized, raw] = this.players[perspective].serializeActions(this.game);
      this._cached_raw = raw;
      state["availableActions"] = serialized;
    } else {
      state["availableActions"] = [];
    }

    if (this.phase === "damage" && this.activePlayer === perspective) {
      state["damageTargets"] = this._getDamageTargets(perspective);
      const opp = this.players[1 - perspective];
      state["faceHitBlocked"] = opp.allies.some((a) => a.defender);
    }

    if (this.phase === "sense_defense" && this.activePlayer === perspective) {
      const p = this.players[perspective];
      state["senseCards"] = p.deck.hand
        .filter((c): c is Action => c instanceof Action && c.data[9] === "sense")
        .map((c) => ({ cardId: c.id, name: c.name, amount: parseInt(c.data[10], 10) }));
      if (this._pending_advance_action && this._pending_advance_action.type === "advance_mission") {
        state["senseMissionName"] = this._pending_advance_action.mission.name;
      }
    }

    if (this.phase === "cloud_defense" && this.activePlayer === perspective) {
      const p = this.players[perspective];
      state["cloudCards"] = p.deck.hand
        .filter((c): c is Action => c instanceof Action && c.data[9] === "cloudP")
        .map((c) => ({ cardId: c.id, name: c.name, reduction: parseInt(c.data[10], 10) }));
      state["incomingDamage"] = this._cloud_damage;
    }

    if (this._pending_prompt && this.activePlayer === perspective) {
      state["prompt"] = this._pending_prompt.toJSON();
    }

    // Log fields: cumulative by default (matches multiplayer semantics).
    state["playerLog"] = this._logs[perspective];
    state["botLog"] = this._logs[1 - perspective];
    // canUndo is perspective-aware: only true for whichever human is currently
    // on their turn and can legitimately roll back. Prevents the opponent's
    // undo button from lighting up during your turn in multiplayer.
    state["canUndo"] = this.activePlayer === perspective && this.canUndo();
    return state;
  }

  /**
   * Consume and return log entries added since the last call, formatted for
   * the single-player hook that wants delta-style logs. Returns two arrays:
   * new entries for perspective (playerLogDelta) and for opponent (botLogDelta).
   */
  consumeLogDeltas(perspective: number = 0): { playerLogDelta: LogEntry[]; botLogDelta: LogEntry[] } {
    const pi = perspective as 0 | 1;
    const oi = (1 - pi) as 0 | 1;
    const playerLogDelta = this._logs[pi].slice(this._logRead[pi]);
    const botLogDelta = this._logs[oi].slice(this._logRead[oi]);
    this._logRead[pi] = this._logs[pi].length;
    this._logRead[oi] = this._logs[oi].length;
    return { playerLogDelta, botLogDelta };
  }

  getBothStates(): [Record<string, unknown>, Record<string, unknown>] {
    return [this.getState(0), this.getState(1)];
  }

  private _getDamageTargets(playerIndex: number) {
    const attacker = this.players[playerIndex];
    const [targets] = this.game.validTargets(attacker);
    return targets.map((t, i) => ({
      index: i, name: t.name, health: t.health, cardId: t.id,
    }));
  }

  // ── Action dispatch ──

  playAction(playerIndex: number, actionIndex: number): Record<string, unknown> {
    if (playerIndex !== this.activePlayer) return { error: "Not your turn" };
    if (this.phase !== "actions") return { error: `Cannot play action in phase: ${this.phase}` };

    const p = this.players[playerIndex] as WebPlayer;

    if (this._cached_raw === null) this.getState(playerIndex);
    if (actionIndex < 0 || actionIndex >= this._cached_raw!.length) {
      return { error: `Invalid action index: ${actionIndex}` };
    }

    const action = this._cached_raw![actionIndex];
    p.clearPromptResponses?.();

    // Record the call for replay before we mutate any state.
    this._pushActionEvent("action", playerIndex, { actionIndex });

    // end_actions: session-managed flow (defer cleanUp until after damage phase
    // so the player can still see their hand during damage assignment).
    if (action.type === "end_actions") {
      const autoBoxings = Math.floor(p.curMoney / 2);
      if (autoBoxings > 0) {
        this._logs[playerIndex].push({
          turn: this.game.turncount,
          text: `Traded ${autoBoxings * 2} money → ${autoBoxings} boxing${autoBoxings > 1 ? "s" : ""}`,
          actionType: "auto_boxing",
        });
      }
      p.curBoxings += autoBoxings;
      p.curMoney = 0;  // pMoney is applied at the start of the next turn instead
      p.curMission = 0;
      p.metalTokens = p.metalTokens.map((v) => p.resetToken(v));
      p.metalTokens[8] = 0;
      p.metalAvailable = new Array(9).fill(0);
      p.metalBurned = new Array(9).fill(0);
      p.charAbility1 = true;
      p.charAbility2 = true;
      p.charAbility3 = true;

      this._defender_hp_at_turn_start = this.players[1 - playerIndex].curHealth;

      if (p.curDamage > 0) {
        this.phase = "damage";
      } else {
        this._executeAttackAndTransition(playerIndex);
      }

      this._cached_raw = null;
      this._pending_prompt = null;
      this._preActionSnapshot = null;
      this._playerSnapBefore = null;
      this._undoStack = [];
      return this._returnState(playerIndex);
    }

    this._preActionSnapshot = this._takeSnapshot();
    this._playerSnapBefore = psnap(p);
    this._missionBefore = p.curMission;
    this._marketTrashIdsBefore = new Set(this.game.market.discard.map((c) => c.id));
    // Snapshot each player's card-id ownership before the action so that any
    // newly-trashed card can be attributed to the player who owned it.
    this._playerCardsBefore = [
      this._playerCardIdSet(0),
      this._playerCardIdSet(1),
    ];
    // Snapshot opponent's discard pile before advance_mission so we can
    // identify which Sense card (if any) got auto-used to block.
    if (action.type === "advance_mission") {
      const opp = this.players[1 - playerIndex];
      this._oppDiscardIdsBefore = new Set(opp.deck.discard.map((c) => c.id));

      // Pause for the defender's sense decision at the moment of the advance
      // (rather than pre-empting it at the end of their previous turn). Only
      // prompts human defenders with unused sense cards who haven't yet
      // answered for this specific advance.
      const oppIndex = (1 - playerIndex) as 0 | 1;
      const oppWeb = opp as WebPlayer;
      if (
        !this._isBot(oppIndex) &&
        oppWeb._sense_flag === null &&
        opp.deck.hand.some((c) => c instanceof Action && c.data[9] === "sense")
      ) {
        this._pending_advance_action = action;
        this.phase = "sense_defense";
        this.activePlayer = oppIndex;
        return this._returnState(playerIndex);
      }
    }
    this._pending_action_index = actionIndex;
    this._accumulated_responses = [];

    return this._attemptAction(action, playerIndex);
  }

  /**
   * Play two actions atomically with a single undo entry. Used for composite
   * UI interactions like "burn card + add metal to target" — pressing one
   * button should be one undo step, not two.
   *
   * Takes a snapshot before the first action, plays both via `playAction`
   * (which each push their own snapshots), then collapses the stack so only
   * the pre-composite snapshot remains as the undo point for the pair.
   */
  playComposite(
    playerIndex: number,
    firstIndex: number,
    secondMatch: { code: number; cardIds?: number[] },
  ): Record<string, unknown> {
    if (playerIndex !== this.activePlayer) return { error: "Not your turn" };
    if (this.phase !== "actions") return { error: `Cannot play action in phase: ${this.phase}` };

    const stackLenBefore = this._undoStack.length;
    const preCompositeSnapshot = this._takeSnapshot();

    const first = this.playAction(playerIndex, firstIndex) as Record<string, unknown> & {
      error?: string;
      availableActions?: Array<{ index: number; code: number; cardId?: number }>;
    };
    if (first.error) return first;
    if (this.phase !== "actions") return first;

    const serialized = first.availableActions ?? [];
    const secondAction = serialized.find(
      (a) =>
        a.code === secondMatch.code &&
        (secondMatch.cardIds === undefined ||
          (a.cardId !== undefined && secondMatch.cardIds.includes(a.cardId))),
    );
    if (!secondAction) return first;

    const second = this.playAction(playerIndex, secondAction.index);

    // Collapse any snapshots pushed during the composite into a single entry,
    // OR-ing their dirty tags so the composite is undoable only when none of
    // its inner steps revealed info.
    let anyDirty = false;
    while (this._undoStack.length > stackLenBefore) {
      const popped = this._undoStack.pop()!;
      if (popped.dirty) anyDirty = true;
    }
    preCompositeSnapshot.dirty = anyDirty;
    this._undoStack.push(preCompositeSnapshot);

    return second;
  }

  /**
   * Advance the given mission as many times as the player can afford in a
   * single atomic dispatch. Used by the "+All" button; guest MP clients
   * invoke this via a pending action so the host applies the full sequence
   * rather than just one advance.
   */
  advanceAllMission(playerIndex: number, missionName: string): Record<string, unknown> {
    if (playerIndex !== this.activePlayer) return { error: "Not your turn" };
    if (this.phase !== "actions") return { error: `Cannot play action in phase: ${this.phase}` };
    while (true) {
      if (this.phase !== "actions") break;
      this.getState(playerIndex);
      const raw = this._cached_raw;
      if (!raw) break;
      const actionIdx = raw.findIndex(
        (a) => a.type === "advance_mission" && a.mission.name === missionName,
      );
      if (actionIdx < 0) break;
      const result = this.playAction(playerIndex, actionIdx);
      if (result && (result as { error?: string }).error) break;
    }
    return this._returnState(playerIndex);
  }

  private _attemptAction(action: GameActionInternal, playerIndex: number): Record<string, unknown> {
    const p = this.players[playerIndex] as WebPlayer;
    try {
      p.performAction(action, this.game);
    } catch (e) {
      if (e instanceof PromptNeeded) {
        this._pending_prompt = e;
        this.phase = "awaiting_prompt";
        if (this._preActionSnapshot) this._restoreSnapshot(this._preActionSnapshot);
        this._cached_raw = null;
        const [, raw] = p.serializeActions(this.game);
        this._cached_raw = raw;
        return this._returnState(playerIndex);
      }
      throw e;
    }

    this._pending_prompt = null;
    this._accumulated_responses = [];
    const revealedInfo = this._preActionSnapshot ? this._didRevealInfo(this._preActionSnapshot) : false;

    const snapBefore = this._playerSnapBefore!;
    const snapAfter = psnap(p);
    const effects = diffToText(snapBefore, snapAfter);
    const source = this._actionSourceName(action, playerIndex);
    const missionBefore = this._missionBefore;

    const card = ("card" in action && action.card) ? action.card.toJSON() as CardData : undefined;
    const metalIndex = ("metalIndex" in action && typeof (action as { metalIndex?: number }).metalIndex === "number")
      ? (action as { metalIndex: number }).metalIndex
      : undefined;

    // Detect cards eliminated during this action (newly appeared in market trash).
    // For buy_eliminate/buy_elim_boxings, the bought card itself enters the trash
    // as part of the action semantics — exclude it from the human-readable log
    // so it's not double-reported, but still credit the buyer with the
    // elimination in the persistent counter (they did just trash a card).
    const trashBefore = this._marketTrashIdsBefore;
    const excludeId = (action.type === "buy_eliminate" || action.type === "buy_elim_boxings")
      ? action.card.id : null;
    const eliminatedNames: string[] = [];
    if (trashBefore) {
      for (const c of this.game.market.discard) {
        if (trashBefore.has(c.id)) continue;
        // Persistent attribution: which player owned this card before the action?
        const before = this._playerCardsBefore;
        if (before) {
          if (before[0].has(c.id))      this.players[0].eliminatedCardNames.push(c.name);
          else if (before[1].has(c.id)) this.players[1].eliminatedCardNames.push(c.name);
          else this.players[playerIndex].eliminatedCardNames.push(c.name); // bought-and-eliminated from market
        }
        // Human-readable log entry skips the buy_eliminate target.
        if (c.id !== excludeId) eliminatedNames.push(c.name);
      }
    }
    if (eliminatedNames.length > 0) {
      effects.push(`eliminated ${eliminatedNames.join(", ")}`);
    }
    if (source) {
      const log = this._logs[playerIndex];
      if (action.type === "buy" || action.type === "buy_with_boxings") {
        log.push({ turn: this.game.turncount, text: source, card, actionType: action.type, metalIndex });
      } else if (action.type === "buy_boxing") {
        log.push({ turn: this.game.turncount, text: source, actionType: action.type });
      } else if (action.type === "buy_eliminate" || action.type === "buy_elim_boxings") {
        const filtered = effects.filter((e) => !e.includes("money"));
        log.push({
          turn: this.game.turncount,
          text: filtered.length > 0 ? `${source}: ${filtered.join(", ")}` : source,
          card, actionType: action.type, metalIndex,
        });
      } else if (action.type === "advance_mission") {
        const filtered = effects.filter((e) => e !== "-1 mission");
        if (filtered.length > 0) {
          log.push({ turn: this.game.turncount, text: `${source}: ${filtered.join(", ")}`, actionType: action.type });
        }
      } else if (card) {
        // Any card-bearing action (use_metal, burn_card, refresh_metal, ally_ability_*)
        // always logs so the opponent's UI can flash it, regardless of measurable effects.
        const text = effects.length > 0 ? `${source}: ${effects.join(", ")}` : source;
        log.push({ turn: this.game.turncount, text, card, actionType: action.type, metalIndex });
      } else if (metalIndex !== undefined) {
        // Metal-only actions (burn_metal, flare_metal, use_atium). diffToText doesn't
        // track token state, so always log these so the activity log + combiner can see them.
        const text = effects.length > 0 ? `${source}: ${effects.join(", ")}` : source;
        log.push({ turn: this.game.turncount, text, actionType: action.type, metalIndex });
      } else if (effects.length > 0) {
        log.push({ turn: this.game.turncount, text: `${source}: ${effects.join(", ")}`, actionType: action.type, metalIndex });
      }
    }

    if (action.type === "advance_mission") {
      const missionSpent = missionBefore - p.curMission;
      // Skip when resolveSense is driving — it pushes the sense_block entry
      // itself with direct knowledge of the chosen card, avoiding duplicates.
      if (missionSpent !== 1 && !this._resolvingSense) {
        // Identify which opponent Sense card was auto-used (newly appeared in discard).
        const opp = this.players[1 - playerIndex];
        const before = this._oppDiscardIdsBefore;
        let senseCard: CardData | undefined = undefined;
        for (const c of opp.deck.discard) {
          if (before && !before.has(c.id) && c instanceof Action && c.data[9] === "sense") {
            senseCard = c.toJSON() as CardData;
            break;
          }
        }
        this._logs[1 - playerIndex].push({
          turn: this.game.turncount,
          text: `Used ${senseCard?.name ?? "Sense"} to block mission advance (−${missionSpent} mission)`,
          card: senseCard,
          actionType: "sense_block",
        });
      }
      this._oppDiscardIdsBefore = null;
    }

    if (this._preActionSnapshot) {
      this._preActionSnapshot.dirty = revealedInfo;
      this._undoStack.push(this._preActionSnapshot);
    }

    this._preActionSnapshot = null;
    this._playerSnapBefore = null;
    this._marketTrashIdsBefore = null;
    this._playerCardsBefore = null;

    if (this.game.winner) {
      this.phase = "game_over";
      this._undoStack = [];
    }
    this._cached_raw = null;
    return this._returnState(playerIndex);
  }

  respondToPrompt(playerIndex: number, promptType: string, value: number | boolean): Record<string, unknown> {
    if (playerIndex !== this.activePlayer) return { error: "Not your turn" };
    if (this.phase !== "awaiting_prompt" || !this._pending_prompt) return { error: "No pending prompt" };
    if (promptType !== this._pending_prompt.promptType) {
      return { error: `Expected prompt type ${this._pending_prompt.promptType}, got ${promptType}` };
    }
    if (this._preActionSnapshot === null || this._pending_action_index === null) {
      return { error: "No pre-action snapshot — cannot replay" };
    }

    this._accumulated_responses.push([promptType, value]);
    this._pending_prompt = null;
    this.phase = "actions";

    this._pushActionEvent("prompt", playerIndex, { promptType, value });

    const p = this.players[playerIndex] as WebPlayer;
    const [, raw] = p.serializeActions(this.game);
    this._cached_raw = raw;
    const action = this._cached_raw[this._pending_action_index];
    p.clearPromptResponses();
    for (const [ptype, pvalue] of this._accumulated_responses) {
      p.setPromptResponse(ptype, pvalue);
    }
    return this._attemptAction(action, playerIndex);
  }

  assignDamage(playerIndex: number, targetIndex: number): Record<string, unknown> {
    if (playerIndex !== this.activePlayer) return { error: "Not your turn" };
    if (this.phase !== "damage") return { error: `Cannot assign damage in phase: ${this.phase}` };

    this._pushActionEvent("damage", playerIndex, { targetIndex });

    const p = this.players[playerIndex];
    if (targetIndex === -1) {
      this._executeAttackAndTransition(playerIndex);
      return this._returnState(playerIndex);
    }
    if (targetIndex === -2) {
      // Skip face-hit: zero damage and transition. Used when the opponent has
      // a defender (face-hit blocked) or when the attacker chooses not to.
      p.curDamage = 0;
      this._executeAttackAndTransition(playerIndex);
      return this._returnState(playerIndex);
    }

    const [targets, opp] = this.game.validTargets(p);
    if (targetIndex < 0 || targetIndex >= targets.length) {
      return { error: `Invalid target index: ${targetIndex}` };
    }
    const target = targets[targetIndex];
    p.curDamage -= target.health;
    opp.killAlly(target);
    this._logs[playerIndex].push({ turn: this.game.turncount, text: `Killed ${opp.name}'s ${target.name}` });
    this._logs[1 - playerIndex].push({ turn: this.game.turncount, text: `Opponent killed your ${target.name}` });

    const [newTargets] = this.game.validTargets(p);
    // Only auto-transition when there's no leftover damage to deal. If the
    // kill used all the damage, hand off to the opponent silently; otherwise
    // keep the damage phase open so the player can see remaining damage and
    // explicitly confirm the face-hit (avoids the "turn ended too fast" feel).
    if (newTargets.length === 0 && p.curDamage === 0) {
      this._executeAttackAndTransition(playerIndex);
    }
    return this._returnState(playerIndex);
  }

  resolveSense(playerIndex: number, use: boolean): Record<string, unknown> {
    if (playerIndex !== this.activePlayer) return { error: "Not your turn" };
    if (this.phase !== "sense_defense") return { error: `Cannot resolve sense in phase: ${this.phase}` };

    this._pushActionEvent("sense", playerIndex, { use });

    const defender = this.players[playerIndex] as WebPlayer;
    defender._sense_flag = use;

    const pending = this._pending_advance_action;
    if (pending) {
      this._pending_advance_action = null;
      const attackerIndex = (1 - playerIndex) as 0 | 1;
      this.phase = "actions";
      this.activePlayer = attackerIndex;

      // Identify the sense card the defender is about to use, before
      // _attemptAction moves it from hand to discard. Logging from here
      // (rather than _attemptAction's post-detection) means the entry is
      // pushed regardless of whether the temp-var bookkeeping survives the
      // pause/resume cycle.
      let usedSenseCard: Action | undefined = undefined;
      if (use && pending.type === "advance_mission") {
        usedSenseCard = defender.deck.hand.find(
          (c): c is Action => c instanceof Action && c.data[9] === "sense",
        );
      }

      this._resolvingSense = true;
      const result = this._attemptAction(pending, attackerIndex);
      this._resolvingSense = false;

      if (usedSenseCard) {
        const senseValue = parseInt(usedSenseCard.data[10], 10);
        this._logs[playerIndex].push({
          turn: this.game.turncount,
          text: `Used ${usedSenseCard.name} to block mission advance (−${senseValue} mission)`,
          card: usedSenseCard.toJSON() as CardData,
          actionType: "sense_block",
        });
      }

      // Reset so the next advance_mission this turn prompts again.
      defender._sense_flag = null;
      return result;
    }

    // Fallback for callers still using the legacy pre-turn prompt path.
    this._startNextTurn(this._next_player_after_sense);
    return this._returnState(playerIndex);
  }

  /** Resolve cloud defense for a single damage event with the defender's
   *  full set of cloud-card commits. Empty array = "take the damage." All
   *  cards are validated up front, then applied atomically; the phase
   *  always exits afterward, so one popup = one decision per damage event. */
  resolveCloud(playerIndex: number, cardIds: number[]): Record<string, unknown> {
    if (playerIndex !== this.activePlayer) return { error: "Not your turn" };
    if (this.phase !== "cloud_defense") return { error: `Cannot resolve cloud in phase: ${this.phase}` };

    this._pushActionEvent("cloud", playerIndex, { cardIds });

    const p = this.players[playerIndex];
    const attackerIndex = (1 - playerIndex) as 0 | 1;

    const cards: Action[] = [];
    const seen = new Set<number>();
    for (const cardId of cardIds) {
      if (seen.has(cardId)) continue;
      seen.add(cardId);
      const card = p.deck.hand.find(
        (c): c is Action => c instanceof Action && c.id === cardId && c.data[9] === "cloudP",
      );
      if (!card) return { error: `Cloud card ${cardId} not found in hand` };
      cards.push(card);
    }

    for (const card of cards) {
      const reduction = parseInt(card.data[10], 10);
      p.curHealth = Math.min(p.curHealth + reduction, 40);
      const idx = p.deck.hand.indexOf(card);
      if (idx !== -1) p.deck.hand.splice(idx, 1);
      p.deck.discard.push(card);
    }

    if (cards.length > 0) {
      const totalReduction = cards.reduce((sum, c) => sum + parseInt(c.data[10], 10), 0);
      const cardNames = cards.map((c) => c.name).join(" + ");
      const cardsData = cards.map((c) => c.toJSON() as CardData);
      this._logs[playerIndex].push({
        turn: this.game.turncount,
        text: `${cardNames} blocked ${totalReduction} damage`,
        cards: cardsData,
        actionType: "cloud_block",
      });
      this._logs[attackerIndex].push({
        turn: this.game.turncount,
        text: `Opponent's ${cardNames} blocked ${totalReduction} damage`,
        cards: cardsData,
        actionType: "cloud_block",
      });
    }

    if (p.curHealth > 0) {
      p.alive = true;
      if (this.game.victoryType === "D" && this.game.winner !== p) {
        this.game.winner = null;
        this.game.victoryType = "";
      }
    }

    if (this.game.winner) this.phase = "game_over";
    else this._postAttackCleanup(attackerIndex);
    return this._returnState(playerIndex);
  }

  forfeit(playerIndex: number): Record<string, unknown> {
    this._pushActionEvent("forfeit", playerIndex, {});
    const winnerIndex = (1 - playerIndex) as 0 | 1;
    this.game.winner = this.players[winnerIndex];
    this.game.victoryType = "F";
    this.phase = "game_over";
    return this._returnState(playerIndex);
  }

  // ── Turn flow internals ──

  private _executeAttackAndTransition(attackerIndex: number) {
    const pi = attackerIndex as 0 | 1;
    const oi = (1 - pi) as 0 | 1;
    const p = this.players[pi];
    const opp = this.players[oi];

    const oppHpBefore = this._defender_hp_at_turn_start ?? opp.curHealth;
    this.game.attack(p);
    p.curDamage = 0;  // pDamage is applied at the start of the next turn instead
    const hpLost = oppHpBefore - opp.curHealth;

    if (hpLost > 0) {
      this._logs[pi].push({ turn: this.game.turncount, text: `Dealt ${hpLost} damage to ${opp.name}` });
    }

    const cloudCards = opp.deck.hand.filter((c): c is Action => c instanceof Action && c.data[9] === "cloudP");
    if (hpLost > 0 && cloudCards.length > 0) {
      this._cloud_damage = hpLost;
      this._logs[oi].push({ turn: this.game.turncount, text: `Incoming: ${hpLost} damage` });
      this.phase = "cloud_defense";
      this.activePlayer = oi;
      // If the defender is a bot, auto-skip cloud defense (bot's cloudP already
      // returns false; matching prior single-player behavior).
      if (this._isBot(oi)) {
        this.resolveCloud(oi, []);
      }
      return;
    }

    if (this.game.winner) { this.phase = "game_over"; return; }
    this._postAttackCleanup(pi);
  }

  private _postAttackCleanup(attackerIndex: number) {
    const pi = attackerIndex as 0 | 1;
    const oi = (1 - pi) as 0 | 1;
    const p = this.players[pi];

    // Humans: cleanUp is deferred until now (so they could see their hand in
    // the damage phase). Bots already cleaned up inside performAction("end_actions")
    // before attack — don't double-clean.
    if (!this._isBot(pi)) {
      p.deck.cleanUp(p, this.game.market);
      for (const ally of p.allies) ally.reset();
    }

    if (this.game.winner) { this.phase = "game_over"; return; }

    // For human-vs-human, sense defense is prompted at the moment of each
    // advance_mission (see playAction). For human-vs-bot, the bot's turn
    // runs synchronously and can't pause mid-advance, so keep the legacy
    // pre-turn prompt in that specific case only.
    if (!this._isBot(pi) && this._isBot(oi)) {
      const senseCards = p.deck.hand.filter((c): c is Action => c instanceof Action && c.data[9] === "sense");
      if (senseCards.length > 0) {
        this.phase = "sense_defense";
        this.activePlayer = pi;
        this._next_player_after_sense = oi;
        return;
      }
    }
    if (!this._isBot(pi)) {
      (p as WebPlayer)._sense_flag = null;
    }

    this._startNextTurn(oi);
  }

  private _startNextTurn(nextPlayerIndex: number) {
    const nextPi = nextPlayerIndex as 0 | 1;
    this.activePlayer = nextPi;
    this.game.turncount += 1;
    if (this.game.turncount > 1000) {
      this.game.victoryType = "T";
      this.game.winner = this.players[0];
      this.phase = "game_over";
      return;
    }

    // Start-of-turn effects: arrive BEFORE training.
    // 1. Apply permanent bonuses (curMoney = pMoney, curDamage = pDamage)
    // 2. Play pending allies/funding drawn at end of last turn (they move to
    //    zone / give money now).
    const p = this.players[nextPi];
    p.curMoney = p.pMoney;
    p.curDamage = p.pDamage;
    this._playPending(nextPi);

    this._resolveTraining(nextPi);
    this.phase = "actions";
    this._cached_raw = null;
    this._defender_hp_at_turn_start = null;
    this._preActionSnapshot = null;
    this._playerSnapBefore = null;
    this._undoStack = [];

    if (this._isBot(nextPi)) {
      this._runBotTurn(nextPi);
    }
  }

  /** Play any allies/funding sitting in hand with pending=true. Allies move
   *  to the zone + run play(); funding runs play() for money. Clears flag. */
  private _playPending(playerIndex: number) {
    const p = this.players[playerIndex];
    const hand = p.deck.hand;
    // Allies: move to zone, run play(), remove from hand
    const remaining: Card[] = [];
    for (const c of hand) {
      if (c.pending && c instanceof Ally) {
        c.pending = false;
        c.play(p);
        p.allies.push(c);
      } else {
        remaining.push(c);
      }
    }
    p.deck.hand = remaining;
    // Funding: play() for money but keep in hand
    for (const c of p.deck.hand) {
      if (c.pending && c instanceof Funding) {
        c.pending = false;
        c.play(p);
      }
    }
  }

  private _resolveTraining(playerIndex: number) {
    const p = this.players[playerIndex];
    const snap = psnap(p);
    p.resolve("T", "1");
    let effects = diffToText(snap, psnap(p));
    effects = effects.filter((e) => e !== "+1 training");
    if (effects.length > 0) {
      this._logs[playerIndex].push({
        turn: this.game.turncount,
        text: `Training reward (level ${p.training}): ${effects.join(", ")}`,
      });
    }
  }

  /** Run a bot's full turn (training already resolved). Handles logging,
   *  opponent-visible events (ally kills, sense blocks, damage, cloud check). */
  private _runBotTurn(botIndex: number) {
    const bi = botIndex as 0 | 1;
    const oi = (1 - bi) as 0 | 1;
    const bot = this.players[bi];
    const opp = this.players[oi];

    const oppHpBefore = opp.curHealth;
    const oppAlliesBefore = opp.allies.map((a) => a.name);
    const oppHandBefore = new Set(opp.deck.hand.map((c) => c.id));

    // Wrap bot.performAction to capture each action for the bot log
    const originalPerform = bot.performAction.bind(bot);
    const botTurn = this.game.turncount;
    const bi_captured = bi;
    bot.performAction = (action: GameActionInternal, g: Game) => {
      // Lookahead bots (Zoom) call performAction inside snapshot/restore
      // simulation loops to evaluate candidates. Those calls must NOT pollute
      // the activity log or the structured action-event stream — only the
      // committed action does. Bots opt into this by setting _simulating
      // on themselves around their simulation blocks.
      if ((bot as Player & { _simulating?: boolean })._simulating) {
        return originalPerform(action, g);
      }
      const desc = bot.serializeAction(action, g).description;
      const card = ("card" in action && action.card) ? action.card.toJSON() as CardData : undefined;
      const mi = ("metalIndex" in action && typeof (action as { metalIndex?: number }).metalIndex === "number")
        ? (action as { metalIndex: number }).metalIndex
        : undefined;
      this._logs[bi_captured].push({ turn: botTurn, text: desc, card, actionType: action.type, metalIndex: mi });
      // Record the bot's move in the structured action log. Bot moves are
      // informational at replay time (the bot regenerates them from the
      // seeded RNG) but valuable for post-game review. Bots that score
      // alternatives (e.g. SquashBot) expose lastDecisionAnnotation() so
      // we can attach the considered options + scores to the event.
      const annotation =
        (bot as Player & { lastDecisionAnnotation?: () => ActionAnnotation | null }).lastDecisionAnnotation?.() ?? undefined;
      this._pushActionEvent(
        "bot_action",
        bi_captured,
        {
          actionType: action.type,
          description: desc,
          ...(card ? { cardName: card.name } : {}),
          ...(mi !== undefined ? { metalIndex: mi } : {}),
        },
        annotation ?? undefined,
      );
      return originalPerform(action, g);
    };

    try {
      // Bot's Player.playTurn: calls training (already done → re-does it, so
      // skip that by running takeActions+assignDamage+attack manually).
      // Actually Player.playTurn re-trains. Instead we mirror it minus training.
      bot.takeActions(this.game);
      bot.assignDamage(this.game);
      this.game.attack(bot);
      bot.curDamage = bot.pDamage;
    } finally {
      bot.performAction = originalPerform;
    }

    // Opponent-visible logs: ally kills, sense usage, damage
    const killed = oppAlliesBefore.filter((n) => !opp.allies.some((a) => a.name === n));
    for (const name of killed) {
      this._logs[oi].push({ turn: botTurn, text: `Opponent killed your ${name}` });
    }
    const oppHandAfter = new Set(opp.deck.hand.map((c) => c.id));
    const usedIds = [...oppHandBefore].filter((id) => !oppHandAfter.has(id));
    for (const card of opp.deck.discard) {
      if (usedIds.includes(card.id) && card instanceof Action && card.data[9] === "sense") {
        this._logs[oi].push({
          turn: botTurn,
          text: `${card.name} blocked a mission advance`,
          card: card.toJSON() as CardData,
          actionType: "sense_block",
        });
      }
    }

    const hpLost = oppHpBefore - opp.curHealth;

    // Check cloud defense for opponent
    const cloudCards = opp.deck.hand.filter((c): c is Action => c instanceof Action && c.data[9] === "cloudP");
    if (hpLost > 0 && cloudCards.length > 0) {
      this._cloud_damage = hpLost;
      this._logs[oi].push({ turn: botTurn, text: `Incoming: ${hpLost} damage` });
      this.phase = "cloud_defense";
      this.activePlayer = oi;
      // If the opp is also a bot (shouldn't happen in normal single/multiplayer
      // but cheap to handle), auto-skip.
      if (this._isBot(oi)) {
        this.resolveCloud(oi, []);
      }
      return;
    }

    if (hpLost > 0) {
      this._logs[oi].push({ turn: botTurn, text: `Dealt ${hpLost} damage to you` });
    }

    if (this.game.winner) { this.phase = "game_over"; return; }

    // Use the same post-attack path as humans. For bots, this skips cleanUp
    // (already done in end_actions) and the sense prompt (auto-true).
    this._postAttackCleanup(bi);
  }

  // ── Multiplayer-specific payload ──

  /** Data to write to InstantDB after an action (host-only). */
  getInstantDBPayload(): Record<string, unknown> {
    const [p0State, p1State] = this.getBothStates();
    let p0Prompt: Record<string, unknown> | null = null;
    let p1Prompt: Record<string, unknown> | null = null;
    if (this._pending_prompt && this.phase === "awaiting_prompt") {
      const promptData = this._pending_prompt.toJSON();
      if (this.activePlayer === 0) p0Prompt = promptData;
      else p1Prompt = promptData;
    }
    return {
      phase: this.phase,
      activePlayer: this.activePlayer,
      turnCount: this.game.turncount,
      p0State, p1State, p0Prompt, p1Prompt,
      winner: this.game.winner?.name ?? "",
      victoryType: this.game.victoryType || "",
      updatedAt: Date.now(),
    };
  }
}
