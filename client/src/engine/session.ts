/**
 * GameSession: manages a single-player game (human vs bot).
 * Ported from server/session.py with added undo support.
 */

import { Game, type PlayerFactory } from "./game";
import { Action, Ally, Card } from "./card";
import { Player } from "./player";
import { WebPlayer } from "./webPlayer";
import { Twonky } from "./bot";
import { TwonkyV2 } from "./botV2";
import { SynergyBotPrime } from "./synergyBot";
import { PromptNeeded } from "./prompt";
import type { GameActionInternal } from "./types";
import { METAL_NAMES } from "./types";

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
}

// ── Snapshot helpers for effect logging ──

interface Snapshot {
  damage: number;
  money: number;
  health: number;
  mission: number;
  training: number;
  atium: number;
  burns: number;
  handSize: number;
  pDamage: number;
  pMoney: number;
  hand_count: number;
  allies: string[];
}

function snapshot(p: Player): Snapshot {
  return {
    damage: p.curDamage,
    money: p.curMoney,
    health: p.curHealth,
    mission: p.curMission,
    training: p.training,
    atium: p.atium,
    burns: p.burns,
    handSize: p.handSize,
    pDamage: p.pDamage,
    pMoney: p.pMoney,
    hand_count: p.deck.hand.length,
    allies: p.allies.map((a) => a.name),
  };
}

function diffToText(before: Snapshot, after: Snapshot): string[] {
  const parts: string[] = [];
  const diffs: [keyof Snapshot, string][] = [
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

// ── Logging bot wrapper ──

interface LogEntry {
  turn: number;
  text: string;
  card?: unknown;
  actionType?: string;
}

class LoggingBot {
  bot: Player;
  private session: GameSession;

  constructor(bot: Player, session: GameSession) {
    this.bot = bot;
    this.session = session;
  }

  playTurn(game: Game) {
    const originalPerform = this.bot.performAction.bind(this.bot);
    const botTurn = game.turncount;
    const self = this;

    this.bot.performAction = function (action: GameActionInternal, g: Game) {
      const desc = self.bot.serializeAction(action, g).description;
      const card = ("card" in action && action.card) ? action.card.toJSON() : undefined;
      self.session._bot_log.push({ turn: botTurn, text: desc, card, actionType: action.type });
      return originalPerform(action, g);
    };

    try {
      this.bot.playTurn(game);
    } finally {
      this.bot.performAction = originalPerform;
    }
  }
}

// ── GameSession ──

export type GamePhase = "actions" | "damage" | "sense_defense" | "cloud_defense" | "awaiting_prompt" | "game_over";

export class GameSession {
  id: string;
  playerName: string;
  character: string;
  opponentType: string;
  opponentCharacter: string;
  game: Game;
  human: WebPlayer;
  private _realBot: Player;
  private bot: LoggingBot;
  phase: GamePhase = "actions";

  _bot_log: LogEntry[] = [];
  private _player_log: LogEntry[] = [];
  private _pending_prompt: PromptNeeded | null = null;
  private _pending_action_index: number | null = null;
  private _accumulated_responses: [string, number | boolean][] = [];
  private _cached_raw: GameActionInternal[] | null = null;
  private _cloud_damage = 0;

  // Snapshot of state at the start of the current in-flight action — used for
  // rolling back mid-action on PromptNeeded. Cleared once the action completes.
  private _preActionSnapshot: GameSnapshot | null = null;
  // Stack of committed snapshots (one per completed clean action). Each entry
  // can be restored by undo. Cleared when a dirty action happens or the phase
  // changes (end actions, start of turn, etc).
  private _undoStack: Array<{ snapshot: GameSnapshot; logIndex: number }> = [];
  // Once an action reveals hidden info (draw / market refill), no undo is
  // allowed for the rest of this action sequence.
  private _dirty = false;
  // For effect logging of the current in-flight action
  private _playerSnapBefore: Snapshot | null = null;
  private _missionBefore = 0;
  // Log index of the entry produced by the current in-flight action (if any)
  private _lastLogIndex = -1;

  constructor(opts: {
    playerName?: string;
    character?: string;
    opponentType?: string;
    opponentCharacter?: string;
    botFirst?: boolean;
    testDeck?: boolean;
  } = {}) {
    const {
      playerName = "Player",
      character = "Kelsier",
      opponentType = "twonky",
      opponentCharacter = "Shan",
      botFirst = true,
      testDeck = false,
    } = opts;

    this.id = crypto.randomUUID();
    this.playerName = playerName;
    this.character = character;
    this.opponentType = opponentType;
    this.opponentCharacter = opponentCharacter;

    const BotClass =
      opponentType === "twonkyV2" ? TwonkyV2 :
      opponentType === "synergy" ? SynergyBotPrime :
      Twonky;
    const botFactory: PlayerFactory = (deck, game, to, name, char) =>
      new BotClass(deck, game, to, name, char);
    const humanFactory: PlayerFactory = (deck, game, to, name, char) =>
      new WebPlayer(deck, game, to, name, char);

    this.game = new Game({
      names: [playerName, `${opponentType.charAt(0).toUpperCase() + opponentType.slice(1)} Bot`],
      chars: [character, opponentCharacter],
      playerFactories: [humanFactory, botFactory],
      testDeck,
    });

    this.human = this.game.players[0] as WebPlayer;
    this._realBot = this.game.players[1];
    this.bot = new LoggingBot(this._realBot, this);

    if (botFirst) {
      this.game.turncount += 1;
      const humanHpBefore = this.human.curHealth;
      this.bot.playTurn(this.game);
      const hpLost = humanHpBefore - this.human.curHealth;
      if (hpLost > 0) {
        this._bot_log.push({ turn: this.game.turncount, text: `Dealt ${hpLost} damage to you` });
      }
      if (this.game.winner) {
        this.phase = "game_over";
        return;
      }
      this.game.turncount += 1;
      this._resolveTraining();
    } else {
      this.game.turncount += 1;
      this._resolveTraining();
    }
  }

  // ── Snapshot / restore ──

  /** Capture full engine state in a form that can be restored exactly. */
  private _takeSnapshot(): GameSnapshot {
    const winner = this.game.winner;
    const winnerIndex = winner ? winner.turnOrder : null;

    const players: PlayerSnapshot[] = this.game.players.map((p) => ({
      curDamage: p.curDamage,
      curMoney: p.curMoney,
      curMission: p.curMission,
      curHealth: p.curHealth,
      curBoxings: p.curBoxings,
      training: p.training,
      atium: p.atium,
      burns: p.burns,
      pDamage: p.pDamage,
      pMoney: p.pMoney,
      handSize: p.handSize,
      alive: p.alive,
      smoking: p.smoking,
      charAbility1: p.charAbility1,
      charAbility2: p.charAbility2,
      charAbility3: p.charAbility3,
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

    // Capture all card states (sought, burned, metalUsed, ally flags)
    const cardStates = new Map<number, CardStateSnap>();
    for (const c of this._allCards()) {
      const s: CardStateSnap = { sought: c.sought };
      if (c instanceof Action) {
        s.burned = c.burned;
        s.metalUsed = c.metalUsed;
      } else if (c instanceof Ally) {
        s.available1 = c.available1;
        s.available2 = c.available2;
        s.availableRiot = c.availableRiot;
      }
      cardStates.set(c.id, s);
    }

    return {
      winnerIndex,
      victoryType: this.game.victoryType,
      turncount: this.game.turncount,
      missionRanks: this.game.missions.map((m) => [...m.playerRanks]),
      marketHand: this.game.market.hand.map((c) => c.id),
      marketCards: this.game.market.cards.map((c) => c.id),
      marketDiscard: this.game.market.discard.map((c) => c.id),
      players,
      cardStates,
      hiddenCardIds: this._hiddenCardIds(),
    };
  }

  /** Restore engine state from a snapshot. Cards are located by ID. */
  private _restoreSnapshot(snap: GameSnapshot): void {
    // Build ID → card lookup (cards never leave the game, so this covers all of them)
    const byId = new Map<number, Card>();
    for (const c of this._allCards()) byId.set(c.id, c);

    this.game.winner = snap.winnerIndex !== null ? this.game.players[snap.winnerIndex] : null;
    this.game.victoryType = snap.victoryType;
    this.game.turncount = snap.turncount;

    for (let i = 0; i < this.game.missions.length; i++) {
      this.game.missions[i].playerRanks = [...snap.missionRanks[i]];
    }

    this.game.market.hand = snap.marketHand.map((id) => byId.get(id)!).filter(Boolean);
    this.game.market.cards = snap.marketCards.map((id) => byId.get(id)!).filter(Boolean);
    this.game.market.discard = snap.marketDiscard.map((id) => byId.get(id)!).filter(Boolean);

    for (let i = 0; i < this.game.players.length; i++) {
      const p = this.game.players[i];
      const ps = snap.players[i];
      p.curDamage = ps.curDamage;
      p.curMoney = ps.curMoney;
      p.curMission = ps.curMission;
      p.curHealth = ps.curHealth;
      p.curBoxings = ps.curBoxings;
      p.training = ps.training;
      p.atium = ps.atium;
      p.burns = ps.burns;
      p.pDamage = ps.pDamage;
      p.pMoney = ps.pMoney;
      p.handSize = ps.handSize;
      p.alive = ps.alive;
      p.smoking = ps.smoking;
      p.charAbility1 = ps.charAbility1;
      p.charAbility2 = ps.charAbility2;
      p.charAbility3 = ps.charAbility3;
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

    // Restore per-card internal state
    for (const [id, s] of snap.cardStates) {
      const c = byId.get(id);
      if (!c) continue;
      c.sought = s.sought;
      if (c instanceof Action) {
        c.burned = s.burned ?? false;
        c.metalUsed = s.metalUsed ?? 0;
      } else if (c instanceof Ally) {
        c.available1 = s.available1 ?? false;
        c.available2 = s.available2 ?? false;
        c.availableRiot = s.availableRiot ?? false;
      }
    }
  }

  private _allCards(): Card[] {
    const cards: Card[] = [];
    cards.push(...this.game.market.hand, ...this.game.market.cards, ...this.game.market.discard);
    for (const p of this.game.players) {
      cards.push(...p.deck.hand, ...p.deck.cards, ...p.deck.discard, ...p.deck.setAside);
      cards.push(...p.allies);
    }
    return cards;
  }

  /** Cards whose identity is currently hidden from the human player. */
  private _hiddenCardIds(): Set<number> {
    const ids = new Set<number>();
    // Player's own deck (face-down)
    for (const c of this.human.deck.cards) ids.add(c.id);
    // Opponent's hand + deck (everything the human can't see)
    const opp = this.game.players[1];
    for (const c of opp.deck.hand) ids.add(c.id);
    for (const c of opp.deck.cards) ids.add(c.id);
    for (const c of opp.deck.setAside) ids.add(c.id);
    // Market deck (not yet revealed)
    for (const c of this.game.market.cards) ids.add(c.id);
    return ids;
  }

  /** True if, relative to the given snapshot, a previously-hidden card is now visible. */
  private _didRevealInfo(snap: GameSnapshot): boolean {
    const currentHidden = this._hiddenCardIds();
    for (const id of snap.hiddenCardIds) {
      if (!currentHidden.has(id)) return true;
    }
    return false;
  }

  // ── Undo (uses snapshot stack) ──

  canUndo(): boolean {
    return (
      this._undoStack.length > 0 &&
      !this._dirty &&
      this.phase === "actions"
    );
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    const entry = this._undoStack.pop()!;
    this._restoreSnapshot(entry.snapshot);
    // Remove the log entry produced by the action we're undoing
    if (entry.logIndex >= 0 && entry.logIndex < this._player_log.length) {
      this._player_log.splice(entry.logIndex, 1);
    }
    this._cached_raw = null;
    return true;
  }

  // ── State getters ──

  private _getDamageTargets() {
    const [targets] = this.game.validTargets(this.human);
    return targets.map((t, i) => ({
      index: i, name: t.name, health: t.health, cardId: t.id,
    }));
  }

  private _actionSourceName(action: GameActionInternal): string | null {
    switch (action.type) {
      case "burn_card": return `${action.card.name} (burn)`;
      case "use_metal": return action.card.name;
      case "burn_metal": return `Burn ${METAL_NAMES[action.metalIndex]}`;
      case "flare_metal": return `Flare ${METAL_NAMES[action.metalIndex]}`;
      case "ally_ability_1": return `${action.card.name} ability 1`;
      case "ally_ability_2": return `${action.card.name} ability 2`;
      case "char_ability_1": return `${this.human.character} ability I`;
      case "char_ability_3": return `${this.human.character} ability III`;
      case "buy": return `Bought ${action.card.name} for ${action.card.cost}`;
      case "buy_eliminate": return `Buy+eliminate ${action.card.name}`;
      case "buy_with_boxings": return `Bought ${action.card.name} for ${action.card.cost} (${action.boxingsCost} boxings)`;
      case "buy_elim_boxings": return `Buy+eliminate ${action.card.name} (${action.boxingsCost} boxings)`;
      case "advance_mission": return `Mission ${action.mission.name}`;
      case "refresh_metal": return `Refresh ${METAL_NAMES[action.metalIndex]} with ${action.card.name}`;
      default: return null;
    }
  }

  getState() {
    const state: Record<string, unknown> = this.game.toJSON(0);
    state["sessionId"] = this.id;
    state["phase"] = this.phase;

    if (this.phase === "actions") {
      const [serialized, raw] = this.human.serializeActions(this.game);
      this._cached_raw = raw;
      state["availableActions"] = serialized;
    } else {
      state["availableActions"] = [];
    }

    if (this.phase === "damage") {
      state["damageTargets"] = this._getDamageTargets();
    }

    if (this.phase === "sense_defense") {
      state["senseCards"] = this.human.deck.hand
        .filter((c): c is Action => c instanceof Action && c.data[9] === "sense")
        .map((c) => ({ cardId: c.id, name: c.name, amount: parseInt(c.data[10], 10) }));
    }

    if (this.phase === "cloud_defense") {
      state["cloudCards"] = this.human.deck.hand
        .filter((c): c is Action => c instanceof Action && c.data[9] === "cloudP")
        .map((c) => ({ cardId: c.id, name: c.name, reduction: parseInt(c.data[10], 10) }));
      state["incomingDamage"] = this._cloud_damage;
    }

    if (this._pending_prompt) {
      state["prompt"] = this._pending_prompt.toJSON();
    }

    state["botLog"] = this._bot_log;
    this._bot_log = [];
    state["playerLog"] = this._player_log;
    this._player_log = [];
    state["canUndo"] = this.canUndo();

    return state;
  }

  // ── Action handling ──

  playAction(actionIndex: number) {
    if (this.phase !== "actions") return { error: `Cannot play action in phase: ${this.phase}` };

    if (this._cached_raw === null) this.getState();
    if (actionIndex < 0 || actionIndex >= this._cached_raw!.length) {
      return { error: `Invalid action index: ${actionIndex}` };
    }

    const action = this._cached_raw![actionIndex];
    this.human.clearPromptResponses();

    // End actions transitions out of the actions phase — no snapshot/rollback needed.
    if (action.type === "end_actions") {
      const h = this.human;
      h.curBoxings += Math.floor(h.curMoney / 2);
      h.curMoney = h.pMoney;
      h.curMission = 0;
      h.metalTokens = h.metalTokens.map((v) => h.resetToken(v));
      h.metalTokens[8] = 0;
      h.metalAvailable = new Array(9).fill(0);
      h.metalBurned = new Array(9).fill(0);
      h.charAbility1 = true;
      h.charAbility2 = true;
      h.charAbility3 = true;

      if (h.curDamage > 0) {
        this.phase = "damage";
      } else {
        this.game.attack(h);
        h.curDamage = h.pDamage;
        this._cleanupAndFinish();
      }

      this._cached_raw = null;
      this._pending_prompt = null;
      // Left the actions phase — clear undo state
      this._preActionSnapshot = null;
      this._playerSnapBefore = null;
      this._undoStack = [];
      this._dirty = false;
      this._lastLogIndex = -1;
      return this.getState();
    }

    // Take snapshot BEFORE the action — enables prompt rollback and undo.
    this._preActionSnapshot = this._takeSnapshot();
    this._playerSnapBefore = snapshot(this.human);
    this._missionBefore = this.human.curMission;
    this._pending_action_index = actionIndex;
    this._accumulated_responses = [];

    return this._attemptAction(action);
  }

  /** Run the action, handling PromptNeeded by restoring state and awaiting input. */
  private _attemptAction(action: GameActionInternal) {
    try {
      this.human.performAction(action, this.game);
    } catch (e) {
      if (e instanceof PromptNeeded) {
        this._pending_prompt = e;
        this.phase = "awaiting_prompt";
        // Roll back partial mutations so the replay starts clean.
        if (this._preActionSnapshot) this._restoreSnapshot(this._preActionSnapshot);
        this._cached_raw = null;
        const [, raw] = this.human.serializeActions(this.game);
        this._cached_raw = raw;
        return this.getState();
      }
      throw e;
    }

    // Action completed — finalize logging and info-reveal state.
    this._pending_prompt = null;
    this._accumulated_responses = [];

    const revealedInfo = this._preActionSnapshot
      ? this._didRevealInfo(this._preActionSnapshot)
      : false;

    const snapBefore = this._playerSnapBefore!;
    const snapAfter = snapshot(this.human);
    const effects = diffToText(snapBefore, snapAfter);
    const source = this._actionSourceName(action);
    const missionBefore = this._missionBefore;

    this._lastLogIndex = -1;
    if (source) {
      if (action.type === "buy" || action.type === "buy_with_boxings") {
        this._lastLogIndex = this._player_log.length;
        this._player_log.push({ turn: this.game.turncount, text: source });
      } else if (action.type === "buy_eliminate" || action.type === "buy_elim_boxings") {
        const filtered = effects.filter((e) => !e.includes("money"));
        this._lastLogIndex = this._player_log.length;
        this._player_log.push({
          turn: this.game.turncount,
          text: filtered.length > 0 ? `${source}: ${filtered.join(", ")}` : source,
        });
      } else if (action.type === "advance_mission") {
        const filtered = effects.filter((e) => e !== "-1 mission");
        if (filtered.length > 0) {
          this._lastLogIndex = this._player_log.length;
          this._player_log.push({ turn: this.game.turncount, text: `${source}: ${filtered.join(", ")}` });
        }
      } else if (effects.length > 0) {
        this._lastLogIndex = this._player_log.length;
        this._player_log.push({ turn: this.game.turncount, text: `${source}: ${effects.join(", ")}` });
      }
    }

    // Log sense block
    if (action.type === "advance_mission") {
      const missionSpent = missionBefore - this.human.curMission;
      if (missionSpent !== 1) {
        this._bot_log.push({
          turn: this.game.turncount,
          text: `Opponent used Sense to block mission advance! (−${missionSpent} mission)`,
        });
      }
    }

    // Commit the snapshot to the undo stack — only while we haven't crossed a
    // dirty action. Once dirty, we stop pushing (undo is blocked anyway).
    if (!this._dirty && this._preActionSnapshot) {
      this._undoStack.push({
        snapshot: this._preActionSnapshot,
        logIndex: this._lastLogIndex,
      });
    }
    if (revealedInfo) this._dirty = true;

    this._preActionSnapshot = null;
    this._playerSnapBefore = null;

    if (this.game.winner) {
      this.phase = "game_over";
      this._undoStack = []; // No undo past game over
    }
    this._cached_raw = null;
    return this.getState();
  }

  // ── Prompt response ──

  respondToPrompt(promptType: string, value: number | boolean) {
    if (this.phase !== "awaiting_prompt" || !this._pending_prompt) {
      return { error: "No pending prompt" };
    }
    if (promptType !== this._pending_prompt.promptType) {
      return { error: `Expected prompt type ${this._pending_prompt.promptType}, got ${promptType}` };
    }
    if (this._preActionSnapshot === null || this._pending_action_index === null) {
      return { error: "No pre-action snapshot — cannot replay" };
    }

    this._accumulated_responses.push([promptType, value]);
    this._pending_prompt = null;
    this.phase = "actions";

    // State was already restored when the prompt was thrown; re-cache actions,
    // queue all accumulated responses, and replay from the original action.
    const [, raw] = this.human.serializeActions(this.game);
    this._cached_raw = raw;
    const action = this._cached_raw[this._pending_action_index];
    this.human.clearPromptResponses();
    for (const [ptype, pvalue] of this._accumulated_responses) {
      this.human.setPromptResponse(ptype, pvalue);
    }

    return this._attemptAction(action);
  }

  // ── Damage phase ──

  assignDamage(targetIndex: number) {
    if (this.phase !== "damage") return { error: `Cannot assign damage in phase: ${this.phase}` };

    if (targetIndex === -1) {
      this.game.attack(this.human);
      this.human.curDamage = this.human.pDamage;
      this._cleanupAndFinish();
      return this.getState();
    }

    const [targets, opp] = this.game.validTargets(this.human);
    if (targetIndex < 0 || targetIndex >= targets.length) {
      return { error: `Invalid target index: ${targetIndex}` };
    }

    const target = targets[targetIndex];
    this.human.curDamage -= target.health;
    opp.killAlly(target);

    const [newTargets] = this.game.validTargets(this.human);
    if (newTargets.length === 0) {
      this.game.attack(this.human);
      this.human.curDamage = this.human.pDamage;
      this._cleanupAndFinish();
    }

    return this.getState();
  }

  // ── Sense defense ──

  resolveSense(use: boolean) {
    if (this.phase !== "sense_defense") return { error: `Cannot resolve sense in phase: ${this.phase}` };
    (this.human as WebPlayer)._sense_flag = use;
    this._runBotTurn();
    return this.getState();
  }

  // ── Cloud defense ──

  resolveCloud(cardId: number) {
    if (this.phase !== "cloud_defense") return { error: `Cannot resolve cloud in phase: ${this.phase}` };

    if (cardId === -1) {
      if (this.game.winner) this.phase = "game_over";
      else this._startNextHumanTurn();
      return this.getState();
    }

    let card: Action | null = null;
    for (const c of this.human.deck.hand) {
      if (c.id === cardId && c instanceof Action && c.data[9] === "cloudP") {
        card = c;
        break;
      }
    }
    if (!card) return { error: "Cloud card not found in hand" };

    const reduction = parseInt(card.data[10], 10);
    this.human.curHealth = Math.min(this.human.curHealth + reduction, 40);
    const idx = this.human.deck.hand.indexOf(card);
    if (idx !== -1) this.human.deck.hand.splice(idx, 1);
    this.human.deck.discard.push(card);

    this._bot_log.push({ turn: this.game.turncount, text: `Your ${card.name} blocked ${reduction} damage` });

    if (this.human.curHealth > 0) {
      this.human.alive = true;
      if (this.game.victoryType === "D" && this.game.winner !== this.human) {
        this.game.winner = null;
        this.game.victoryType = "";
      }
    }

    const remaining = this.human.deck.hand.filter(
      (c): c is Action => c instanceof Action && c.data[9] === "cloudP"
    );
    if (remaining.length === 0) {
      if (this.game.winner) this.phase = "game_over";
      else this._startNextHumanTurn();
    }

    return this.getState();
  }

  // ── Internal turn flow ──

  private _cleanupAndFinish() {
    this.human.deck.cleanUp(this.human, this.game.market);
    for (const ally of this.human.allies) ally.reset();
    this._finishHumanTurn();
  }

  private _finishHumanTurn() {
    if (this.game.winner) { this.phase = "game_over"; return; }

    this.game.turncount += 1;
    if (this.game.turncount > 1000) {
      this.game.victoryType = "T";
      this.game.winner = this.game.players[1];
      this.phase = "game_over";
      return;
    }

    const senseCards = this.human.deck.hand.filter(
      (c): c is Action => c instanceof Action && c.data[9] === "sense"
    );
    if (senseCards.length > 0) {
      this.phase = "sense_defense";
      return;
    }

    (this.human as WebPlayer)._sense_flag = false;
    this._runBotTurn();
  }

  private _runBotTurn() {
    const humanHpBefore = this.human.curHealth;
    const humanAlliesBefore = this.human.allies.map((a) => a.name);
    const humanHandBefore = new Set(this.human.deck.hand.map((c) => c.id));

    this.bot.playTurn(this.game);
    const botTurn = this.game.turncount;

    // Log ally kills
    const killed = humanAlliesBefore.filter(
      (n) => !this.human.allies.some((a) => a.name === n)
    );
    for (const name of killed) {
      this._bot_log.push({ turn: botTurn, text: `Killed your ${name}` });
    }

    // Log sense card usage
    const humanHandAfter = new Set(this.human.deck.hand.map((c) => c.id));
    const usedIds = [...humanHandBefore].filter((id) => !humanHandAfter.has(id));
    for (const card of this.human.deck.discard) {
      if (usedIds.includes(card.id) && card instanceof Action && card.data[9] === "sense") {
        this._bot_log.push({ turn: botTurn, text: `Your ${card.name} blocked a mission advance` });
      }
    }

    const hpLost = humanHpBefore - this.human.curHealth;

    // Check cloud defense
    const cloudCards = this.human.deck.hand.filter(
      (c): c is Action => c instanceof Action && c.data[9] === "cloudP"
    );
    if (hpLost > 0 && cloudCards.length > 0) {
      this._cloud_damage = hpLost;
      this._bot_log.push({ turn: botTurn, text: `Incoming: ${hpLost} damage` });
      this.phase = "cloud_defense";
      return;
    }

    if (hpLost > 0) {
      this._bot_log.push({ turn: botTurn, text: `Dealt ${hpLost} damage to you` });
    }

    if (this.game.winner) { this.phase = "game_over"; return; }
    this._startNextHumanTurn();
  }

  private _startNextHumanTurn() {
    this.game.turncount += 1;
    this._resolveTraining();
    this.phase = "actions";
    this._cached_raw = null;
    // Fresh turn — no snapshots yet, dirty flag reset
    this._preActionSnapshot = null;
    this._playerSnapBefore = null;
    this._undoStack = [];
    this._dirty = false;
    this._lastLogIndex = -1;
  }

  private _resolveTraining() {
    const snap = snapshot(this.human);
    this.human.resolve("T", "1");
    let effects = diffToText(snap, snapshot(this.human));
    effects = effects.filter((e) => e !== "+1 training");
    if (effects.length > 0) {
      this._player_log.push({
        turn: this.game.turncount,
        text: `Training reward (level ${this.human.training}): ${effects.join(", ")}`,
      });
    }
  }
}
