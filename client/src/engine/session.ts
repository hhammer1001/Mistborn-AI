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
import { SynergyBotPrime } from "./synergyBot";
import { PromptNeeded } from "./prompt";
import type { GameActionInternal } from "./types";
import { METAL_NAMES } from "./types";

// ── Player kinds ──

export type PlayerKind = "human" | "bot_twonky" | "bot_squash" | "bot_synergy";

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
    case "bot_synergy":
      return (deck, game, to, name, char) => new SynergyBotPrime(deck, game, to, name, char);
    case "bot_twonky":
    default:
      return (deck, game, to, name, char) => new Twonky(deck, game, to, name, char);
  }
}

/** Map the legacy opponentType strings from the UI to a PlayerKind. */
export function opponentTypeToKind(opponentType: string): PlayerKind {
  if (opponentType === "squash") return "bot_squash";
  if (opponentType === "synergy") return "bot_synergy";
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
  senseFlag: boolean;
  allyIds: number[];
  handIds: number[];
  deckIds: number[];
  discardIds: number[];
  setAsideIds: number[];
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
interface LogEntry { turn: number; text: string; card?: CardData; actionType?: string }

// ── GameSession ──

export type GamePhase = "actions" | "damage" | "sense_defense" | "cloud_defense" | "awaiting_prompt" | "game_over";

export interface GameSessionOpts {
  players: [PlayerConfig, PlayerConfig];
  firstPlayer?: 0 | 1;
  testDeck?: boolean;
}

export class GameSession {
  id: string;
  game: Game;
  players: Player[];
  playerKinds: PlayerKind[];
  activePlayer: 0 | 1 = 0;
  phase: GamePhase = "actions";

  // Prompt / replay state
  private _pending_prompt: PromptNeeded | null = null;
  private _pending_action_index: number | null = null;
  private _accumulated_responses: [string, number | boolean][] = [];
  private _cached_raw: GameActionInternal[] | null = null;
  private _cloud_damage = 0;
  private _defender_hp_at_turn_start: number | null = null;
  private _next_player_after_sense: 0 | 1 = 0;

  // Snapshot-based prompt rollback and undo
  private _preActionSnapshot: GameSnapshot | null = null;
  private _undoStack: GameSnapshot[] = [];
  private _dirty = false;
  private _playerSnapBefore: PSnap | null = null;
  private _missionBefore = 0;
  // Undo-batch: while open, multiple playAction calls collapse to one undo entry.
  private _batchStart: { snapshot: GameSnapshot; stackLen: number; dirtyBefore: boolean } | null = null;

  // Per-player logs (cumulative). Index 0 = player 0, index 1 = player 1.
  private _logs: [LogEntry[], LogEntry[]] = [[], []];
  // Read-pointer into each log for delta consumption (single-player hook use).
  private _logRead: [number, number] = [0, 0];

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
    });
    this.players = this.game.players;

    const first = opts.firstPlayer ?? 0;
    this.activePlayer = first;
    this.game.turncount = 1;

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
      senseFlag: (p as WebPlayer)._sense_flag ?? false,
      allyIds: p.allies.map((a) => a.id),
      handIds: p.deck.hand.map((c) => c.id),
      deckIds: p.deck.cards.map((c) => c.id),
      discardIds: p.deck.discard.map((c) => c.id),
      setAsideIds: p.deck.setAside.map((c) => c.id),
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
    return {
      winnerIndex: winner ? winner.turnOrder : null,
      victoryType: this.game.victoryType,
      turncount: this.game.turncount,
      missionRanks: this.game.missions.map((m) => [...m.playerRanks]),
      marketHand: this.game.market.hand.map((c) => c.id),
      marketCards: this.game.market.cards.map((c) => c.id),
      marketDiscard: this.game.market.discard.map((c) => c.id),
      players,
      cardStates,
      hiddenCardIds: this._hiddenCardIds(this.activePlayer),
      logLengths: [this._logs[0].length, this._logs[1].length],
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
    return (
      this._undoStack.length > 0 &&
      !this._dirty &&
      this.phase === "actions" &&
      !this._isBot(this.activePlayer)
    );
  }

  /** Open a batch so subsequent playAction calls collapse to one undo entry. */
  beginUndoBatch(): void {
    if (this._batchStart) return;
    this._batchStart = {
      snapshot: this._takeSnapshot(),
      stackLen: this._undoStack.length,
      dirtyBefore: this._dirty,
    };
  }

  /** Close the batch opened by beginUndoBatch; collapses pushed entries. */
  endUndoBatch(): void {
    if (!this._batchStart) return;
    const { snapshot, stackLen, dirtyBefore } = this._batchStart;
    this._batchStart = null;
    while (this._undoStack.length > stackLen) this._undoStack.pop();
    if (!dirtyBefore) this._undoStack.push(snapshot);
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
    this._cached_raw = null;
    return true;
  }

  // ── Action source name (for logs) ──

  private _actionSourceName(action: GameActionInternal, playerIndex: number): string | null {
    const p = this.players[playerIndex];
    switch (action.type) {
      case "burn_card": return `${action.card.name} (burn)`;
      case "use_metal": return action.card.name;
      case "burn_metal": return `Burn ${METAL_NAMES[action.metalIndex]}`;
      case "flare_metal": return `Flare ${METAL_NAMES[action.metalIndex]}`;
      case "ally_ability_1": return `${action.card.name} ability 1`;
      case "ally_ability_2": return `${action.card.name} ability 2`;
      case "char_ability_1": return `${p.character} ability I`;
      case "char_ability_3": return `${p.character} ability III`;
      case "buy": return `Bought ${action.card.name} for ${action.card.cost}`;
      case "buy_eliminate": return `Buy+eliminate ${action.card.name}`;
      case "buy_with_boxings": return `Bought ${action.card.name} for ${action.card.cost} (${action.boxingsCost} boxings)`;
      case "buy_elim_boxings": return `Buy+eliminate ${action.card.name} (${action.boxingsCost} boxings)`;
      case "advance_mission": return `Mission ${action.mission.name}`;
      case "refresh_metal": return `Refresh ${METAL_NAMES[action.metalIndex]} with ${action.card.name}`;
      default: return null;
    }
  }

  // ── State for clients ──

  getState(perspective: number = this.activePlayer): Record<string, unknown> {
    const state: Record<string, unknown> = this.game.toJSON(perspective);
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
    }

    if (this.phase === "sense_defense" && this.activePlayer === perspective) {
      const p = this.players[perspective];
      state["senseCards"] = p.deck.hand
        .filter((c): c is Action => c instanceof Action && c.data[9] === "sense")
        .map((c) => ({ cardId: c.id, name: c.name, amount: parseInt(c.data[10], 10) }));
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

    // end_actions: session-managed flow (defer cleanUp until after damage phase
    // so the player can still see their hand during damage assignment).
    if (action.type === "end_actions") {
      p.curBoxings += Math.floor(p.curMoney / 2);
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
      this._dirty = false;
      return this.getState(playerIndex);
    }

    this._preActionSnapshot = this._takeSnapshot();
    this._playerSnapBefore = psnap(p);
    this._missionBefore = p.curMission;
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
    const dirtyBefore = this._dirty;
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

    // Collapse any snapshots pushed during the composite into a single entry.
    while (this._undoStack.length > stackLenBefore) this._undoStack.pop();
    if (!dirtyBefore) this._undoStack.push(preCompositeSnapshot);

    return second;
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
        return this.getState(playerIndex);
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
    if (source) {
      const log = this._logs[playerIndex];
      if (action.type === "buy" || action.type === "buy_with_boxings") {
        log.push({ turn: this.game.turncount, text: source, card, actionType: action.type });
      } else if (action.type === "buy_eliminate" || action.type === "buy_elim_boxings") {
        const filtered = effects.filter((e) => !e.includes("money"));
        log.push({
          turn: this.game.turncount,
          text: filtered.length > 0 ? `${source}: ${filtered.join(", ")}` : source,
          card, actionType: action.type,
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
        log.push({ turn: this.game.turncount, text, card, actionType: action.type });
      } else if (effects.length > 0) {
        log.push({ turn: this.game.turncount, text: `${source}: ${effects.join(", ")}`, actionType: action.type });
      }
    }

    if (action.type === "advance_mission") {
      const missionSpent = missionBefore - p.curMission;
      if (missionSpent !== 1) {
        this._logs[1 - playerIndex].push({
          turn: this.game.turncount,
          text: `Opponent used Sense to block mission advance! (−${missionSpent} mission)`,
        });
      }
    }

    if (!this._dirty && this._preActionSnapshot) {
      this._undoStack.push(this._preActionSnapshot);
    }
    if (revealedInfo) this._dirty = true;

    this._preActionSnapshot = null;
    this._playerSnapBefore = null;

    if (this.game.winner) {
      this.phase = "game_over";
      this._undoStack = [];
    }
    this._cached_raw = null;
    return this.getState(playerIndex);
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

    const p = this.players[playerIndex];
    if (targetIndex === -1) {
      this._executeAttackAndTransition(playerIndex);
      return this.getState(playerIndex);
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
    if (newTargets.length === 0) {
      this._executeAttackAndTransition(playerIndex);
    }
    return this.getState(playerIndex);
  }

  resolveSense(playerIndex: number, use: boolean): Record<string, unknown> {
    if (playerIndex !== this.activePlayer) return { error: "Not your turn" };
    if (this.phase !== "sense_defense") return { error: `Cannot resolve sense in phase: ${this.phase}` };
    (this.players[playerIndex] as WebPlayer)._sense_flag = use;
    this._startNextTurn(this._next_player_after_sense);
    return this.getState(playerIndex);
  }

  resolveCloud(playerIndex: number, cardId: number): Record<string, unknown> {
    if (playerIndex !== this.activePlayer) return { error: "Not your turn" };
    if (this.phase !== "cloud_defense") return { error: `Cannot resolve cloud in phase: ${this.phase}` };

    const p = this.players[playerIndex];
    const attackerIndex = (1 - playerIndex) as 0 | 1;

    if (cardId === -1) {
      if (this.game.winner) this.phase = "game_over";
      else this._postAttackCleanup(attackerIndex);
      return this.getState(playerIndex);
    }

    let card: Action | null = null;
    for (const c of p.deck.hand) {
      if (c.id === cardId && c instanceof Action && c.data[9] === "cloudP") { card = c; break; }
    }
    if (!card) return { error: "Cloud card not found in hand" };

    const reduction = parseInt(card.data[10], 10);
    p.curHealth = Math.min(p.curHealth + reduction, 40);
    const idx = p.deck.hand.indexOf(card);
    if (idx !== -1) p.deck.hand.splice(idx, 1);
    p.deck.discard.push(card);

    this._logs[playerIndex].push({ turn: this.game.turncount, text: `Your ${card.name} blocked ${reduction} damage` });
    this._logs[attackerIndex].push({ turn: this.game.turncount, text: `Opponent's ${card.name} blocked ${reduction} damage` });

    if (p.curHealth > 0) {
      p.alive = true;
      if (this.game.victoryType === "D" && this.game.winner !== p) {
        this.game.winner = null;
        this.game.victoryType = "";
      }
    }

    const remaining = p.deck.hand.filter((c): c is Action => c instanceof Action && c.data[9] === "cloudP");
    if (remaining.length === 0) {
      if (this.game.winner) this.phase = "game_over";
      else this._postAttackCleanup(attackerIndex);
    }
    return this.getState(playerIndex);
  }

  forfeit(playerIndex: number): Record<string, unknown> {
    const winnerIndex = (1 - playerIndex) as 0 | 1;
    this.game.winner = this.players[winnerIndex];
    this.game.victoryType = "F";
    this.phase = "game_over";
    return this.getState(playerIndex);
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
        this.resolveCloud(oi, -1);
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

    // Only humans need the sense_defense phase to choose whether to activate
    // sense. Bots' senseCheckIn already returns true automatically.
    if (!this._isBot(pi)) {
      const senseCards = p.deck.hand.filter((c): c is Action => c instanceof Action && c.data[9] === "sense");
      if (senseCards.length > 0) {
        this.phase = "sense_defense";
        this.activePlayer = pi;
        this._next_player_after_sense = oi;
        return;
      }
      (p as WebPlayer)._sense_flag = false;
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
    this._dirty = false;

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
      const desc = bot.serializeAction(action, g).description;
      const card = ("card" in action && action.card) ? action.card.toJSON() as CardData : undefined;
      this._logs[bi_captured].push({ turn: botTurn, text: desc, card, actionType: action.type });
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
        this._logs[oi].push({ turn: botTurn, text: `Your ${card.name} blocked a mission advance` });
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
        this.resolveCloud(oi, -1);
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
