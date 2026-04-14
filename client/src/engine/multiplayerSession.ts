/**
 * Multiplayer game session for online play.
 *
 * Designed to be stateless per-request: deserialized from JSON, processes one
 * action, serialized back. All state lives in InstantDB.
 *
 * Port of server/multiplayer_session.py.
 */

import { Game } from "./game";
import { Action, Card, resetCardIds } from "./card";
import { Player } from "./player";
import { WebPlayer, createWebPlayer } from "./webPlayer";
import { PromptNeeded } from "./prompt";
import type { GameActionInternal, SerializedGameAction } from "./types";
import { METAL_NAMES, TRAINING_REWARDS } from "./types";

// ── Snapshot helpers ──

interface Snapshot {
  damage: number; money: number; health: number; mission: number;
  training: number; atium: number; burns: number; handSize: number;
  pDamage: number; pMoney: number; hand_count: number; allies: string[];
}

function snapshot(p: Player): Snapshot {
  return {
    damage: p.curDamage, money: p.curMoney, health: p.curHealth,
    mission: p.curMission, training: p.training, atium: p.atium,
    burns: p.burns, handSize: p.handSize, pDamage: p.pDamage,
    pMoney: p.pMoney, hand_count: p.deck.hand.length,
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

// ── Log entry ──

interface LogEntry { turn: number; text: string }

// ── MultiplayerGameSession ──

export type GamePhase = "actions" | "damage" | "sense_defense" | "cloud_defense" | "awaiting_prompt" | "game_over";

export class MultiplayerGameSession {
  game: Game;
  players: Player[];
  activePlayer = 0;
  phase: GamePhase = "actions";

  // Prompt replay state
  _pending_prompt: PromptNeeded | null = null;
  private _pending_action_index: number | null = null;
  private _accumulated_responses: [string, number | boolean][] = [];

  // Action cache (transient)
  private _cached_raw: GameActionInternal[] | null = null;

  // Per-player logs (cumulative)
  private _log: [LogEntry[], LogEntry[]] = [[], []];

  // Cloud defense tracking
  private _defender_hp_at_turn_start: number | null = null;
  private _cloud_damage = 0;

  // Sense tracking
  private _next_player_after_sense = 0;

  constructor(p0Name: string, p0Char: string, p1Name: string, p1Char: string) {
    resetCardIds();
    this.game = new Game({
      names: [p0Name, p1Name],
      chars: [p0Char, p1Char],
      playerFactories: [createWebPlayer, createWebPlayer],
    });
    this.players = this.game.players;

    // Player 0 goes first
    this.game.turncount = 1;
    this._resolveTraining(0);
  }

  // ── State for clients ──

  getState(perspective: number): Record<string, unknown> {
    const state: Record<string, unknown> = this.game.toJSON(perspective);
    state["phase"] = this.phase;
    state["activePlayer"] = this.activePlayer;
    state["myPlayerIndex"] = perspective;
    state["isMyTurn"] = this.activePlayer === perspective;
    state["turnCount"] = this.game.turncount;

    if (this.game.winner) {
      const winnerIndex = this.game.winner.turnOrder;
      state["isWinner"] = winnerIndex === perspective;
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

    state["playerLog"] = this._log[perspective];
    state["botLog"] = this._log[1 - perspective];

    return state;
  }

  getBothStates(): [Record<string, unknown>, Record<string, unknown>] {
    return [this.getState(0), this.getState(1)];
  }

  // ── Validation ──

  private _validateTurn(playerIndex: number, allowedPhase: string) {
    if (playerIndex !== this.activePlayer) throw new Error("Not your turn");
    if (this.phase !== allowedPhase) throw new Error(`Cannot perform this in phase: ${this.phase}`);
  }

  // ── Helpers ──

  private _active() { return this.players[this.activePlayer]; }
  private _opponent() { return this.players[1 - this.activePlayer]; }

  private _getDamageTargets(playerIndex: number) {
    const attacker = this.players[playerIndex];
    const [targets] = this.game.validTargets(attacker);
    return targets.map((t, i) => ({
      index: i, name: t.name, health: t.health, cardId: t.id,
    }));
  }

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
      case "refresh_metal": return `Refresh ${METAL_NAMES[action.metalIndex]}`;
      default: return null;
    }
  }

  private _logAction(playerIndex: number, action: GameActionInternal, snapBefore: Snapshot, snapAfter: Snapshot) {
    const effects = diffToText(snapBefore, snapAfter);
    const source = this._actionSourceName(action, playerIndex);
    const turn = this.game.turncount;

    if (source) {
      if (action.type === "buy" || action.type === "buy_with_boxings") {
        this._log[playerIndex].push({ turn, text: source });
      } else if (action.type === "buy_eliminate" || action.type === "buy_elim_boxings") {
        const filtered = effects.filter((e) => !e.includes("money"));
        const text = filtered.length > 0 ? `${source}: ${filtered.join(", ")}` : source;
        this._log[playerIndex].push({ turn, text });
      } else if (action.type === "advance_mission") {
        const filtered = effects.filter((e) => e !== "-1 mission");
        if (filtered.length > 0) {
          this._log[playerIndex].push({ turn, text: `${source}: ${filtered.join(", ")}` });
        }
      } else if (effects.length > 0) {
        this._log[playerIndex].push({ turn, text: `${source}: ${effects.join(", ")}` });
      }
    }
  }

  private _resolveTraining(playerIndex: number) {
    const p = this.players[playerIndex];
    const snap = snapshot(p);
    p.resolve("T", "1");
    let effects = diffToText(snap, snapshot(p));
    effects = effects.filter((e) => e !== "+1 training");
    if (effects.length > 0) {
      this._log[playerIndex].push({
        turn: this.game.turncount,
        text: `Training reward (level ${p.training}): ${effects.join(", ")}`,
      });
    }
  }

  // ── Action methods ──

  playAction(playerIndex: number, actionIndex: number): { error?: string } | null {
    this._validateTurn(playerIndex, "actions");
    const pi = playerIndex;
    const p = this.players[pi] as WebPlayer;

    if (this._cached_raw === null) this.getState(pi);
    if (actionIndex < 0 || actionIndex >= this._cached_raw!.length) {
      return { error: `Invalid action index: ${actionIndex}` };
    }

    this._pending_action_index = actionIndex;
    this._accumulated_responses = [];

    const action = this._cached_raw![actionIndex];
    p.clearPromptResponses();

    // End actions
    if (action.type === "end_actions") {
      p.curBoxings += Math.floor(p.curMoney / 2);
      p.curMoney = p.pMoney;
      p.curMission = 0;
      p.metalTokens = p.metalTokens.map((v) => p.resetToken(v));
      p.metalTokens[8] = 0;
      p.metalAvailable = new Array(9).fill(0);
      p.metalBurned = new Array(9).fill(0);
      p.charAbility1 = true;
      p.charAbility2 = true;
      p.charAbility3 = true;

      const opp = this._opponent();
      this._defender_hp_at_turn_start = opp.curHealth;

      if (p.curDamage > 0) {
        this.phase = "damage";
      } else {
        this._executeAttackAndTransition(pi);
      }
      this._cached_raw = null;
      this._pending_prompt = null;
      return null;
    }

    // Normal action
    const snapBefore = snapshot(p);
    const missionBefore = p.curMission;

    try {
      p.performAction(action, this.game);
    } catch (e) {
      if (e instanceof PromptNeeded) {
        this._pending_prompt = e;
        this.phase = "awaiting_prompt";
        this._cached_raw = null;
        const [, raw] = p.serializeActions(this.game);
        this._cached_raw = raw;
        return null;
      }
      throw e;
    }

    this._pending_prompt = null;
    const snapAfter = snapshot(p);
    this._logAction(pi, action, snapBefore, snapAfter);

    // Log sense block
    if (action.type === "advance_mission") {
      const missionSpent = missionBefore - p.curMission;
      if (missionSpent !== 1) {
        this._log[1 - pi].push({
          turn: this.game.turncount,
          text: `Opponent used Sense to block mission advance! (-${missionSpent} mission)`,
        });
      }
    }

    if (this.game.winner) this.phase = "game_over";
    this._cached_raw = null;
    return null;
  }

  respondToPrompt(playerIndex: number, promptType: string, value: number | boolean): { error?: string } | null {
    this._validateTurn(playerIndex, "awaiting_prompt");
    const pi = playerIndex;
    const p = this.players[pi] as WebPlayer;

    if (!this._pending_prompt) return { error: "No pending prompt" };
    if (promptType !== this._pending_prompt.promptType) {
      return { error: `Expected ${this._pending_prompt.promptType}, got ${promptType}` };
    }

    this._accumulated_responses.push([promptType, value]);
    this._pending_prompt = null;
    this.phase = "actions";

    const [, raw] = p.serializeActions(this.game);
    this._cached_raw = raw;
    const action = this._cached_raw[this._pending_action_index!];
    p.clearPromptResponses();
    for (const [ptype, pvalue] of this._accumulated_responses) {
      p.setPromptResponse(ptype, pvalue);
    }

    try {
      p.performAction(action, this.game);
    } catch (e) {
      if (e instanceof PromptNeeded) {
        this._pending_prompt = e;
        this.phase = "awaiting_prompt";
        this._cached_raw = null;
        const [, newRaw] = p.serializeActions(this.game);
        this._cached_raw = newRaw;
        return null;
      }
      throw e;
    }

    this._pending_prompt = null;
    this._accumulated_responses = [];
    this._cached_raw = null;
    if (this.game.winner) this.phase = "game_over";
    return null;
  }

  assignDamage(playerIndex: number, targetIndex: number): { error?: string } | null {
    this._validateTurn(playerIndex, "damage");
    const pi = playerIndex;
    const p = this.players[pi];

    if (targetIndex === -1) {
      this._executeAttackAndTransition(pi);
      return null;
    }

    const [targets, opp] = this.game.validTargets(p);
    if (targetIndex < 0 || targetIndex >= targets.length) {
      return { error: `Invalid target index: ${targetIndex}` };
    }

    const target = targets[targetIndex];
    p.curDamage -= target.health;
    opp.killAlly(target);

    this._log[pi].push({ turn: this.game.turncount, text: `Killed ${opp.name}'s ${target.name}` });
    this._log[1 - pi].push({ turn: this.game.turncount, text: `Opponent killed your ${target.name}` });

    const [newTargets] = this.game.validTargets(p);
    if (newTargets.length === 0) {
      this._executeAttackAndTransition(pi);
    }
    return null;
  }

  resolveSense(playerIndex: number, use: boolean): { error?: string } | null {
    this._validateTurn(playerIndex, "sense_defense");
    (this.players[playerIndex] as WebPlayer)._sense_flag = use;
    this._startNextTurn(this._next_player_after_sense);
    return null;
  }

  resolveCloud(playerIndex: number, cardId: number): { error?: string } | null {
    this._validateTurn(playerIndex, "cloud_defense");
    const pi = playerIndex;
    const p = this.players[pi];
    const attackerIndex = 1 - pi;

    if (cardId === -1) {
      if (this.game.winner) this.phase = "game_over";
      else this._postAttackCleanup(attackerIndex);
      return null;
    }

    let card: Action | null = null;
    for (const c of p.deck.hand) {
      if (c.id === cardId && c instanceof Action && c.data[9] === "cloudP") {
        card = c;
        break;
      }
    }
    if (!card) return { error: "Cloud card not found in hand" };

    const reduction = parseInt(card.data[10], 10);
    p.curHealth = Math.min(p.curHealth + reduction, 40);
    const idx = p.deck.hand.indexOf(card);
    if (idx !== -1) p.deck.hand.splice(idx, 1);
    p.deck.discard.push(card);

    this._log[pi].push({ turn: this.game.turncount, text: `Your ${card.name} blocked ${reduction} damage` });
    this._log[attackerIndex].push({ turn: this.game.turncount, text: `Opponent's ${card.name} blocked ${reduction} damage` });

    if (p.curHealth > 0) {
      p.alive = true;
      if (this.game.victoryType === "D" && this.game.winner !== p) {
        this.game.winner = null;
        this.game.victoryType = "";
      }
    }

    const remaining = p.deck.hand.filter(
      (c): c is Action => c instanceof Action && c.data[9] === "cloudP"
    );
    if (remaining.length === 0) {
      if (this.game.winner) this.phase = "game_over";
      else this._postAttackCleanup(attackerIndex);
    }
    return null;
  }

  forfeit(playerIndex: number) {
    const winnerIndex = 1 - playerIndex;
    this.game.winner = this.players[winnerIndex];
    this.game.victoryType = "F";
    this.phase = "game_over";
  }

  // ── Internal turn flow ──

  private _executeAttackAndTransition(attackerIndex: number) {
    const pi = attackerIndex;
    const oi = 1 - pi;
    const p = this.players[pi];
    const opp = this.players[oi];

    const oppHpBefore = this._defender_hp_at_turn_start ?? opp.curHealth;
    this.game.attack(p);
    p.curDamage = p.pDamage;
    const hpLost = oppHpBefore - opp.curHealth;

    if (hpLost > 0) {
      this._log[pi].push({ turn: this.game.turncount, text: `Dealt ${hpLost} damage to ${opp.name}` });
    }

    // Check cloud defense
    const cloudCards = opp.deck.hand.filter(
      (c): c is Action => c instanceof Action && c.data[9] === "cloudP"
    );
    if (hpLost > 0 && cloudCards.length > 0) {
      this._cloud_damage = hpLost;
      this._log[oi].push({ turn: this.game.turncount, text: `Incoming: ${hpLost} damage` });
      this.phase = "cloud_defense";
      this.activePlayer = oi;
      return;
    }

    if (this.game.winner) { this.phase = "game_over"; return; }
    this._postAttackCleanup(pi);
  }

  private _postAttackCleanup(attackerIndex: number) {
    const pi = attackerIndex;
    const oi = 1 - pi;
    const p = this.players[pi];

    p.deck.cleanUp(p, this.game.market);
    for (const ally of p.allies) ally.reset();

    if (this.game.winner) { this.phase = "game_over"; return; }

    // Check sense
    const senseCards = p.deck.hand.filter(
      (c): c is Action => c instanceof Action && c.data[9] === "sense"
    );
    if (senseCards.length > 0) {
      this.phase = "sense_defense";
      this.activePlayer = pi;
      this._next_player_after_sense = oi;
      return;
    }

    (p as WebPlayer)._sense_flag = false;
    this._startNextTurn(oi);
  }

  private _startNextTurn(nextPlayerIndex: number) {
    this.activePlayer = nextPlayerIndex;
    this.game.turncount += 1;
    if (this.game.turncount > 1000) {
      this.game.victoryType = "T";
      this.game.winner = this.game.players[0];
      this.phase = "game_over";
      return;
    }
    this._resolveTraining(nextPlayerIndex);
    this.phase = "actions";
    this._cached_raw = null;
    this._defender_hp_at_turn_start = null;
  }

  // ── Serialization (replaces pickle) ──
  // For now, we store the full game state JSON in InstantDB.
  // The active player deserializes, runs the action, and writes back.
  // Since we can't easily reconstruct class instances from JSON,
  // we use a simpler approach: the "fullState" is the perspective-filtered
  // state (p0State/p1State) plus enough info for the active player to
  // reconstruct a fresh session.
  //
  // Actually, the cleanest approach: the host client creates the session
  // in memory and holds it. Each action mutates it and writes the
  // perspective states to InstantDB. The opponent reads those states
  // for rendering only. On page refresh, the session is lost — but
  // that's acceptable for now (future: serialize the full session to
  // InstantDB for recovery).

  /** Get the data to write to InstantDB after an action */
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
      p0State,
      p1State,
      p0Prompt,
      p1Prompt,
      winner: this.game.winner?.name ?? "",
      victoryType: this.game.victoryType || "",
      updatedAt: Date.now(),
    };
  }
}
