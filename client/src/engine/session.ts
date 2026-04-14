/**
 * GameSession: manages a single-player game (human vs bot).
 * Ported from server/session.py with added undo support.
 */

import { Game, type PlayerFactory } from "./game";
import { Action, Ally, Card } from "./card";
import { Player } from "./player";
import { WebPlayer } from "./webPlayer";
import { Twonky } from "./bot";
import { PromptNeeded } from "./prompt";
import type { GameActionInternal, SerializedGameAction } from "./types";
import { METAL_NAMES } from "./types";

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
}

class LoggingBot {
  bot: Twonky;
  private session: GameSession;

  constructor(bot: Twonky, session: GameSession) {
    this.bot = bot;
    this.session = session;
  }

  playTurn(game: Game) {
    const originalPerform = this.bot.performAction.bind(this.bot);
    const botTurn = game.turncount;
    const self = this;

    this.bot.performAction = function (action: GameActionInternal, g: Game) {
      const desc = self.bot.serializeAction(action, g).description;
      self.session._bot_log.push({ turn: botTurn, text: desc });
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
  private _realBot: Twonky;
  private bot: LoggingBot;
  phase: GamePhase = "actions";

  _bot_log: LogEntry[] = [];
  private _player_log: LogEntry[] = [];
  private _pending_prompt: PromptNeeded | null = null;
  private _pending_action_index: number | null = null;
  private _accumulated_responses: [string, number | boolean][] = [];
  private _save_state: ReturnType<Game["toJSON"]> | null = null;
  private _cached_raw: GameActionInternal[] | null = null;
  private _cloud_damage = 0;

  // Undo stack
  private _undoStack: string[] = [];

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

    const botFactory: PlayerFactory = (deck, game, to, name, char) =>
      new Twonky(deck, game, to, name, char);
    const humanFactory: PlayerFactory = (deck, game, to, name, char) =>
      new WebPlayer(deck, game, to, name, char);

    this.game = new Game({
      names: [playerName, `${opponentType.charAt(0).toUpperCase() + opponentType.slice(1)} Bot`],
      chars: [character, opponentCharacter],
      playerFactories: [humanFactory, botFactory],
      testDeck,
    });

    this.human = this.game.players[0] as WebPlayer;
    this._realBot = this.game.players[1] as Twonky;
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

  // ── Undo ──

  private _pushUndo() {
    this._undoStack.push(JSON.stringify(this.game.toJSON()));
  }

  canUndo(): boolean {
    return this._undoStack.length > 0 && this.phase === "actions";
  }

  /** Undo is complex because we can't easily reconstruct the full Game from toJSON.
   *  Instead, we save/restore the full game object using a simpler approach:
   *  snapshot the entire session state before each action.
   *  For now, we use a lightweight approach: save just enough to rebuild.
   *
   *  Actually, the simplest correct approach: re-create the game from scratch
   *  with the same parameters, then replay all actions up to N-1.
   *  But that's expensive.
   *
   *  Practical approach: we save the game state JSON and notify the caller
   *  that they need to create a fresh session. The hook will manage this.
   *
   *  Simplest approach that works NOW: the undo stack stores serialized snapshots
   *  of the entire game object via structuredClone-compatible deep copy.
   *  Since our Game class uses toJSON/fromJSON... we don't have fromJSON yet
   *  for the full game. So for Phase 2, we use a different strategy:
   *
   *  We store the raw action history and replay from start. This is correct
   *  but slower. For a card game it's imperceptible.
   */

  // Store action indices for replay-based undo
  private _actionHistory: number[] = [];

  undo(): boolean {
    if (!this.canUndo()) return false;
    // Pop last action and rebuild by replaying all actions except the last
    this._actionHistory.pop();
    this._undoStack.pop();
    // We need to rebuild the session from scratch and replay
    // This is handled by the hook which creates a new session and replays
    return true;
  }

  getActionHistory(): number[] {
    return [...this._actionHistory];
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

    // Save for undo (before the action)
    this._pushUndo();
    this._actionHistory.push(actionIndex);

    // Save state for prompt replay
    this._save_state = structuredClone(this.game.toJSON());
    this._pending_action_index = actionIndex;
    this._accumulated_responses = [];

    const action = this._cached_raw![actionIndex];
    this.human.clearPromptResponses();

    // End actions -> damage phase
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
      this._save_state = null;
      this._undoStack = []; // Clear undo on phase transition
      return this.getState();
    }

    // Snapshot for logging
    const snapBefore = snapshot(this.human);
    const missionBefore = this.human.curMission;

    try {
      this.human.performAction(action, this.game);
    } catch (e) {
      if (e instanceof PromptNeeded) {
        this._pending_prompt = e;
        this.phase = "awaiting_prompt";
        // Undo the undo-push since the action didn't complete
        this._undoStack.pop();
        this._actionHistory.pop();
        // Restore state for retry
        this._cached_raw = null;
        const [, raw] = this.human.serializeActions(this.game);
        this._cached_raw = raw;
        return this.getState();
      }
      throw e;
    }

    this._pending_prompt = null;
    this._save_state = null;

    // Log effects
    const snapAfter = snapshot(this.human);
    const effects = diffToText(snapBefore, snapAfter);
    const source = this._actionSourceName(action);

    if (source) {
      if (action.type === "buy" || action.type === "buy_with_boxings") {
        this._player_log.push({ turn: this.game.turncount, text: source });
      } else if (action.type === "buy_eliminate" || action.type === "buy_elim_boxings") {
        const filtered = effects.filter((e) => !e.includes("money"));
        this._player_log.push({
          turn: this.game.turncount,
          text: filtered.length > 0 ? `${source}: ${filtered.join(", ")}` : source,
        });
      } else if (action.type === "advance_mission") {
        const filtered = effects.filter((e) => e !== "-1 mission");
        if (filtered.length > 0) {
          this._player_log.push({ turn: this.game.turncount, text: `${source}: ${filtered.join(", ")}` });
        }
      } else if (effects.length > 0) {
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

    if (this.game.winner) this.phase = "game_over";
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

    this._accumulated_responses.push([promptType, value]);
    this._pending_prompt = null;
    this.phase = "actions";

    // Now push undo since the action will complete (or prompt again)
    this._pushUndo();
    this._actionHistory.push(this._pending_action_index!);

    // Replay with all responses
    const [, raw] = this.human.serializeActions(this.game);
    this._cached_raw = raw;
    const action = this._cached_raw[this._pending_action_index!];
    this.human.clearPromptResponses();
    for (const [ptype, pvalue] of this._accumulated_responses) {
      this.human.setPromptResponse(ptype, pvalue);
    }

    try {
      this.human.performAction(action, this.game);
    } catch (e) {
      if (e instanceof PromptNeeded) {
        this._pending_prompt = e;
        this.phase = "awaiting_prompt";
        // Undo the push since action still incomplete
        this._undoStack.pop();
        this._actionHistory.pop();
        this._cached_raw = null;
        const [, newRaw] = this.human.serializeActions(this.game);
        this._cached_raw = newRaw;
        return this.getState();
      }
      throw e;
    }

    this._pending_prompt = null;
    this._save_state = null;
    this._accumulated_responses = [];
    this._cached_raw = null;

    if (this.game.winner) this.phase = "game_over";
    return this.getState();
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
    this._undoStack = [];
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
