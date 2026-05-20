import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { GameState, GameAction, BotLogEntry, PlayerData } from "../types/game";
import { GameSession, opponentTypeToKind } from "../engine/session";
import { startingHealthForSeat } from "../engine/player";
import { botLabel } from "../data/ministrySigils";
import { resetCardIds } from "../engine/card";
import { useTurnSideEffects, computeRecap, type TurnRecap } from "./useTurnSideEffects";
import { saveMatchRecord, botIdentity, type MatchIdentity } from "../lib/matchLog";
import { db } from "../lib/instantdb";

// Re-export TurnRecap so existing consumers (LogEntry shape, components)
// keep working without changing imports.
export type { TurnRecap };

// Session methods return Record<string, unknown>; this helper casts safely
interface SessionResult {
  error?: string;
  turnCount?: number;
  phase?: string;
  playerLog?: BotLogEntry[];
  botLog?: BotLogEntry[];
  availableActions?: GameAction[];
  [key: string]: unknown;
}

export interface LogEntry {
  turn: number;
  text: string;
  isBot?: boolean;
  card?: import("../types/game").CardData;
  /** Multiple cards behind a single combined event (e.g. multi-cloud block).
   *  Popups should render all of them; the text already names them. */
  cards?: import("../types/game").CardData[];
  actionType?: string;
  metalIndex?: number;
  recap?: TurnRecap;
}

/** A reactive entry is a defense (Sense / Cloud) that fires during the
 *  other player's action, not a turn-taking action. Used to suppress the
 *  "bot's turn" header when the delta contains only reactive entries. */
function isRealBotTurnEntry(e: BotLogEntry): boolean {
  if (!e.actionType) return false;
  return e.actionType !== "sense_block"
    && e.actionType !== "cloud_block"
    && e.actionType !== "cloud_ally_block"
    && e.actionType !== "opponent_kill";
}

/** Player-log entries that fire DURING or AFTER the opponent's actions —
 *  defender's sense use, cloudA save, damage taken, ally killed. In the
 *  rendered log they should appear AFTER the opponent's action block, not
 *  before it (which is where same-turn playerLog entries would otherwise
 *  land via buildTurnEntries' default ordering). Without this carve-out,
 *  "Dealt 2 damage to you" and "Used Spy to block..." render in front of
 *  the bot's actions that produced them. */
function isReactiveDefenderEntry(e: BotLogEntry): boolean {
  return e.actionType === "sense_block"
    || e.actionType === "opponent_kill"
    || e.actionType === "cloud_block"
    || e.actionType === "cloud_ally_block"
    || e.actionType === "damage_taken"
    || e.actionType === "incoming_damage";
}

/** Entries in the bot's log that are just opponent-perspective mirrors of
 *  things the player already saw in their own log: "Opponent killed your X"
 *  echoes the player's "Killed bot's X", and "Opponent's X blocked Y damage"
 *  echoes the player's "X blocked Y damage". Useful for multiplayer (where
 *  the other side is a human who needs the narration), redundant in SP.
 *
 *  cloud_ally_block is NOT in this list — the single entry lives on the
 *  defender's log (sense_block pattern) so SP players see the bot's save
 *  rendered in opponent-red, not as an effect of their own action. */
function isOpponentMirror(e: BotLogEntry): boolean {
  return e.actionType === "opponent_kill"
    || e.actionType === "cloud_block";
}

/** Assemble log entries from a session result. Handles three layout concerns
 *  uniformly so each handler (playAction, assignDamage, resolveCloud, ...)
 *  doesn't reimplement the same ordering:
 *
 *  1. Player-perspective entries with a turn beyond the player's last turn
 *     (e.g. "Incoming: 2 damage" logged at the bot's turncount) get deferred
 *     to AFTER the bot's actions — otherwise stable-sort places them above
 *     the bot's "X's turn" header inside the bot's block.
 *  2. The bot's turn header is only emitted when the delta contains a real
 *     bot turn entry (not just a reactive sense_block / cloud_block).
 *  3. The player's next-turn header is suppressed when the session paused
 *     mid-bot-turn for a defense interrupt: turncount has incremented to
 *     the bot's turn but the player isn't really starting their turn yet. */
function buildTurnEntries(opts: {
  prevTurn: number;
  data: SessionResult;
  playerLogDelta: BotLogEntry[];
  botLogDelta: BotLogEntry[];
  pName: string;
  bName: string;
  initial?: LogEntry[];
}): LogEntry[] {
  const { prevTurn, data, playerLogDelta, botLogDelta, pName, bName, initial = [] } = opts;
  const newEntries: LogEntry[] = [...initial];

  // Bucket playerLog entries with turn === prevTurn:
  //   - actionEffectLogs: pushed during the player's own action (auto-trade,
  //     diffToText effects). Land BEFORE bot delta — they describe what the
  //     player just did.
  //   - reactiveByPos: defense/received entries from the bot's actions
  //     (sense_block, damage_taken, opponent_kill, etc), keyed by their
  //     `afterBotIdx`. Land INTERLEAVED with the bot delta — "Used Spy to
  //     block mission advance" goes right after the Advance entry that
  //     triggered it, not at the end of the turn.
  //   - reactiveTail: reactive entries that didn't ship an afterBotIdx
  //     (legacy paths). Land after the bot delta as a fallback.
  //   - newTurnPlayerLogs: entries with turn > prevTurn (e.g. training
  //     reward at the start of the next player turn).
  const reactiveByPos = new Map<number, LogEntry[]>();
  const reactiveTail: LogEntry[] = [];
  const newTurnPlayerLogs: LogEntry[] = [];
  for (const entry of playerLogDelta) {
    const formatted: LogEntry = {
      turn: entry.turn,
      text: `  → ${entry.text}`,
      card: entry.card,
      cards: entry.cards,
      actionType: entry.actionType,
      metalIndex: entry.metalIndex,
    };
    if (entry.turn > prevTurn) {
      newTurnPlayerLogs.push(formatted);
    } else if (isReactiveDefenderEntry(entry)) {
      if (entry.afterBotIdx !== undefined) {
        const pos = entry.afterBotIdx;
        const bucket = reactiveByPos.get(pos);
        if (bucket) bucket.push(formatted);
        else reactiveByPos.set(pos, [formatted]);
      } else {
        reactiveTail.push(formatted);
      }
    } else {
      newEntries.push(formatted);
    }
  }

  // Drop opponent-perspective mirrors from the bot delta in SP — the player
  // already saw the same event from their own side. Note this also keeps
  // botTurn (below) anchored to a real bot action rather than getting pulled
  // back to the player's turn by a leading "Opponent killed your X" entry.
  const filteredBotLog = botLogDelta.filter((e) => !isOpponentMirror(e));

  if (filteredBotLog.length > 0) {
    const botTurn = filteredBotLog[0]?.turn ?? prevTurn + 1;
    if (filteredBotLog.some(isRealBotTurnEntry)) {
      newEntries.push({ turn: botTurn, text: `${bName}'s turn`, isBot: true });
    }
    // Walk the bot delta and splice reactive entries in at their
    // `afterBotIdx` positions: reactiveByPos.get(i) renders BEFORE bot
    // entry i (i.e. after `i` bot entries have already been rendered).
    for (let i = 0; i <= filteredBotLog.length; i++) {
      const reactives = reactiveByPos.get(i);
      if (reactives) newEntries.push(...reactives);
      if (i < filteredBotLog.length) {
        const entry = filteredBotLog[i];
        newEntries.push({
          turn: entry.turn,
          text: `${bName} — ${entry.text}`,
          isBot: true,
          card: entry.card,
          cards: entry.cards,
          actionType: entry.actionType,
          metalIndex: entry.metalIndex,
        });
      }
    }
  } else {
    // No bot delta this round — flush any reactive entries by position.
    const sortedKeys = [...reactiveByPos.keys()].sort((a, b) => a - b);
    for (const k of sortedKeys) newEntries.push(...reactiveByPos.get(k)!);
  }

  newEntries.push(...reactiveTail);

  const inDefenseInterrupt =
    data.phase === "cloud_defense" || data.phase === "sense_defense" || data.phase === "ally_defense";
  if ((data.turnCount ?? 0) > prevTurn && !inDefenseInterrupt) {
    newEntries.push({ turn: data.turnCount!, text: `${pName}'s turn` });
  }

  newEntries.push(...newTurnPlayerLogs);
  return newEntries;
}

/** Strip trailing " (×N)", a mission rank suffix " (A→B)", and any ": effects"
 *  tail so two semantically-equivalent log entries compare equal. */
function baseText(text: string): string {
  return text
    .replace(/\s*\(×\d+\)$/, "")
    .replace(/\s*\(\d+→\d+\)(:.*)?$/, "");
}

/** Parse a mission rank suffix "(A→B)" from a log text. */
function parseMissionRank(text: string): { from: number; to: number } | null {
  const m = text.match(/\((\d+)→(\d+)\)/);
  if (!m) return null;
  return { from: parseInt(m[1], 10), to: parseInt(m[2], 10) };
}

/** Merge consecutive identical entries. Mission advances merge by extending
 *  the rank range ("(0→1)" + "(1→2)" → "(0→2)"); everything else collapses
 *  to "X (×N)". */
function consolidateLog(entries: LogEntry[]): LogEntry[] {
  const result: LogEntry[] = [];
  for (const entry of entries) {
    const last = result[result.length - 1];
    if (last && baseText(last.text) === baseText(entry.text) && last.turn === entry.turn && last.isBot === entry.isBot) {
      const lastRank = parseMissionRank(last.text);
      const entryRank = parseMissionRank(entry.text);
      if (lastRank && entryRank) {
        const base = baseText(last.text);
        const from = Math.min(lastRank.from, entryRank.from);
        const to = Math.max(lastRank.to, entryRank.to);
        last.text = `${base} (${from}→${to})`;
      } else {
        const match = last.text.match(/^(.*?)(?:\s*\(×(\d+)\))?$/);
        if (match) {
          const base = match[1];
          const count = parseInt(match[2] ?? "1") + 1;
          last.text = `${base} (×${count})`;
        }
      }
    } else {
      result.push({ ...entry });
    }
  }
  return result;
}

export function useGame() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawLog, setRawLog] = useState<LogEntry[]>([]);
  const playerName = useRef("Player");
  const botName = useRef("Bot");
  const sessionRef = useRef<GameSession | null>(null);

  // Synchronous mirror of rawLog. Read this — not the rawLog state — when
  // you need the *current* length within an event handler, before React has
  // flushed pending setRawLog updates. Updated atomically by appendLog().
  const rawLogRef = useRef<LogEntry[]>([]);

  /** Append entries to rawLog, updating both the synchronous ref and React
   *  state. Use this everywhere rawLog grows so subsequent code in the same
   *  event handler sees the new length immediately. */
  const appendLog = useCallback((newEntries: LogEntry[]) => {
    if (newEntries.length === 0) return;
    const next = consolidateLog([...rawLogRef.current, ...newEntries]);
    rawLogRef.current = next;
    setRawLog(next);
  }, []);

  /** Truncate rawLog to the given length (used by undo). */
  const truncateLog = useCallback((length: number) => {
    const next = rawLogRef.current.slice(0, length);
    rawLogRef.current = next;
    setRawLog(next);
  }, []);

  // Match-log metadata, populated at createGame, consumed on game_over.
  const matchMetaRef = useRef<{
    startedAt: number;
    botStrategy: string;
    testDeck: boolean;
    humanIdentity: MatchIdentity;
  } | null>(null);
  const matchWrittenRef = useRef(false);

  // Single-player perspective is always 0 and isMyTurn is conceptually always
  // true (bot turns run synchronously inside our action calls). The shared
  // hook still detects new bot-log entries → flashes and uses prev/next state
  // diffs → recap. End-turn fires the "opponent" banner imperatively below
  // because there is no isMyTurn=false interval for it to observe.
  const sideEffects = useTurnSideEffects({ gameState, perspective: 0, isMyTurn: true });
  const { flashQueue, recap, banner, recapEntries, consumeFlash, consumeRecap, consumeBanner, clearRecapEntries, setBanner, pushRecap, flagExpectYourBanner, skipTurnAnimations } = sideEffects;

  /** Commit a state update either immediately or behind the opponent-turn
   *  banner. Used whenever a session call may have run the bot's turn inline. */
  const applyBehindBanner = useCallback((botPlayed: boolean, commit: () => void) => {
    if (botPlayed) {
      setBanner("opponent");
      window.setTimeout(commit, 600);
    } else {
      commit();
    }
  }, [setBanner]);

  // Visible log = incrementally-built entries (action descriptions, "→ effect"
  // lines, turn headers) merged with the recap entries materialized by the
  // shared side-effects hook. Stable sort by turn keeps the recap line
  // grouped right after the bot's actions for that turn.
  const log = useMemo<LogEntry[]>(() => {
    if (recapEntries.length === 0) return rawLog;
    const merged = [...rawLog, ...recapEntries];
    merged.sort((a, b) => a.turn - b.turn);
    return consolidateLog(merged);
  }, [rawLog, recapEntries]);

  const createGame = useCallback(
    (
      pName: string,
      character: string,
      opponentType: string,
      opponentCharacter: string,
      botFirst: boolean = true,
      testDeck: boolean = false,
      humanIdentity: MatchIdentity = { profileId: "", userId: "", name: pName },
      seed?: number,
    ) => {
      setLoading(true);
      setError(null);
      setRawLog([]);
      rawLogRef.current = [];
      clearRecapEntries();
      playerName.current = pName;
      botName.current = botLabel(opponentType);

      // Reset match-log guard + capture start metadata for end-of-game write.
      matchWrittenRef.current = false;
      matchMetaRef.current = {
        startedAt: Date.now(),
        botStrategy: opponentType,
        testDeck,
        humanIdentity: { ...humanIdentity, name: humanIdentity.name || pName },
      };

      try {
        resetCardIds();
        const botKind = opponentTypeToKind(opponentType);
        const session = new GameSession({
          players: [
            { kind: "human", name: pName, character },
            { kind: botKind, name: botLabel(opponentType), character: opponentCharacter },
          ],
          firstPlayer: botFirst ? 1 : 0,
          testDeck,
          ...(seed !== undefined ? { seed } : {}),
        });
        sessionRef.current = session;
        const data = session.getState(0) as unknown as GameState;
        setGameState(data);

        // Consume the initial log deltas (bot-first turn produces bot-log entries).
        const { botLogDelta } = session.consumeLogDeltas(0);

        const initLog: LogEntry[] = [{ turn: 1, text: "Game started" }];
        const bName = botLabel(opponentType);
        if (botLogDelta.length > 0) {
          if (botLogDelta.some(isRealBotTurnEntry)) {
            initLog.push({ turn: 1, text: `${bName}'s turn`, isBot: true });
          }
          for (const entry of botLogDelta) {
            initLog.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true, card: entry.card, cards: entry.cards, actionType: entry.actionType, metalIndex: entry.metalIndex });
          }
          // Flashes are derived declaratively by useTurnSideEffects from the
          // initial gameState. Recap has no prior snapshot to diff against,
          // so synthesize one from the engine's starting-HP rule (via
          // startingHealthForSeat — the single source of truth) plus zero
          // training / mission ranks / allies, then push imperatively.
          const firstPlayerIndex = botFirst ? 1 : 0;
          const startHp = (p: PlayerData) =>
            startingHealthForSeat(p.turnOrder, firstPlayerIndex).health;
          const baseline: GameState = {
            ...data,
            players: data.players.map((p, i) =>
              i === 0
                ? { ...p, health: startHp(p) }
                : { ...p, health: startHp(p), training: 0, allies: [] }
            ) as PlayerData[],
            missions: data.missions.map((m) => ({
              ...m,
              playerRanks: m.playerRanks.map(() => 0),
            })),
          };
          const r = computeRecap(baseline, data, botLogDelta, 0, 1);
          if (r) {
            const lastEntry = botLogDelta[botLogDelta.length - 1];
            pushRecap(r, lastEntry?.turn ?? 1, bName);
          } else {
            // Ensure "your turn" banner still fires at the end of bot-first.
            flagExpectYourBanner();
          }
        }
        if (data.turnCount > 1) {
          initLog.push({ turn: data.turnCount, text: `${pName}'s turn` });
        }
        rawLogRef.current = initLog;
        setRawLog(initLog);
        return data;
      } catch (e) {
        setError(String(e));
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const playAction = useCallback(
    (actionIndex: number, descOverride?: string) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      // The player is acting — cut any in-flight opponent-turn animations
      // (card flashes, recap modal) immediately. The recap log entry is
      // already pinned at the end of the bot's turn and stays.
      skipTurnAnimations();
      // descOverride lets a caller (e.g. playTwoActions) supply a description
      // it already resolved against fresher availableActions. Inside the same
      // event handler, gameState in this closure is still the pre-first-action
      // snapshot — looking up by index against it would land on the wrong
      // action because the engine reshuffles indices after each play.
      const action = gameState.availableActions.find((a) => a.index === actionIndex);
      const desc = descOverride ?? action?.description ?? `Action ${actionIndex}`;
      const prevTurn = gameState.turnCount;
      const pName = playerName.current;
      const bName = botName.current;

      setError(null);

      // Tag the snapshot the engine is about to take with our current rawLog
      // length. Whether the action completes immediately or via prompt, the
      // same snapshot is what undo eventually restores — so the tag travels
      // with it and tells us where to slice rawLog back to.
      session.setNextSnapshotData(rawLogRef.current.length);

      try {
        const data = session.playAction(0, actionIndex) as SessionResult;
        if (data.error) { setError(data.error); return null; }
        const { playerLogDelta, botLogDelta } = session.consumeLogDeltas(0);

        const newEntries = buildTurnEntries({
          prevTurn, data, playerLogDelta, botLogDelta, pName, bName,
          initial: [{ turn: prevTurn, text: `${pName} — ${desc}` }],
        });

        // If the bot actually played, defer the gameState update behind the
        // "opponent's turn" banner so the transition feels like a hand-off.
        // End-actions that just enter damage phase (no bot entries) skip this.
        applyBehindBanner(botLogDelta.some(isRealBotTurnEntry), () => {
          setGameState(data as unknown as GameState);
          appendLog(newEntries);
        });
        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState, appendLog, applyBehindBanner, skipTurnAnimations]
  );

  const advanceAllMission = useCallback(
    (missionName: string) => {
      if (!gameState) return;
      const session = sessionRef.current;
      if (!session) return;

      // Find and play all mission advances for this mission
      let current: GameState | null = gameState;
      while (current) {
        const action = current.availableActions.find(
          (a) => a.code === 1 && a.missionName === missionName
        );
        if (!action) break;
        const result = playAction(action.index) as unknown as GameState | null;
        if (!result || result.phase === "game_over") break;
        current = result;
      }
    },
    [gameState, playAction]
  );

  const playTwoActions = useCallback(
    (firstIndex: number, secondMatch: { code: number; cardIds?: number[] }) => {
      const session = sessionRef.current;
      if (!session) return null;
      // Tag the batch's snapshot with the pre-composite rawLog length. Each
      // inner playAction also tags its own snapshot — those get popped in
      // endUndoBatch, EXCEPT when an inner triggers a prompt (its kept
      // _preActionSnapshot lands on the stack via respondToPrompt later, and
      // carries its own tag — the post-burn length).
      session.setNextSnapshotData(rawLogRef.current.length);
      session.beginUndoBatch();
      try {
        const first = playAction(firstIndex) as unknown as SessionResult | null;
        if (!first) return null;
        const actions = (first.availableActions ?? []) as GameAction[];
        const second = actions.find((a) => a.code === secondMatch.code
          && (secondMatch.cardIds === undefined || (a.cardId !== undefined && secondMatch.cardIds.includes(a.cardId))));
        if (!second) return first;
        return playAction(second.index, second.description);
      } finally {
        session.endUndoBatch();
      }
    },
    [playAction]
  );

  const respondToPrompt = useCallback(
    (promptType: string, value: number) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.respondToPrompt(0, promptType, value) as SessionResult;
        if (data.error) { setError(data.error); return null; }
        const { playerLogDelta, botLogDelta } = session.consumeLogDeltas(0);

        const bName = botName.current;
        const pName = playerName.current;
        const newEntries = buildTurnEntries({
          prevTurn: gameState.turnCount, data, playerLogDelta, botLogDelta, pName, bName,
        });

        applyBehindBanner(botLogDelta.some(isRealBotTurnEntry), () => {
          setGameState(data as unknown as GameState);
          appendLog(newEntries);
        });
        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState, applyBehindBanner, appendLog]
  );

  const assignDamage = useCallback(
    (targetIndex: number) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.assignDamage(0, targetIndex) as SessionResult;
        if (data.error) { setError(data.error); return null; }
        const { playerLogDelta, botLogDelta } = session.consumeLogDeltas(0);

        const bName = botName.current;
        const pName = playerName.current;

        const initial: LogEntry[] = [];
        if (targetIndex === -1) {
          const dmg = gameState.players[0].damage;
          if (dmg > 0) {
            initial.push({ turn: gameState.turnCount, text: `${pName} dealt ${dmg} damage to ${bName}` });
          }
        } else if (targetIndex === -2) {
          // Skip: explicitly dealt no damage this turn. No log entry needed.
        } else {
          const target = gameState.damageTargets?.find((t) => t.index === targetIndex);
          // The engine may swallow the kill via cloudA (e.g. defender's Hide).
          // Soften the verb when that happens so the action line matches the
          // resulting "Used Hide to save X" effect below it. The cloud_ally
          // entry lives on the defender's log (bot log from the player's
          // perspective), so check botLogDelta — not playerLogDelta.
          const wasBlocked = botLogDelta.some((e) => e.actionType === "cloud_ally_block");
          const verb = wasBlocked ? "attempted to kill" : "killed";
          initial.push({ turn: gameState.turnCount, text: `${pName} ${verb} ${target?.name ?? "ally"} (${target?.health ?? "?"} HP)` });
        }

        const newEntries = buildTurnEntries({
          prevTurn: gameState.turnCount, data, playerLogDelta, botLogDelta, pName, bName, initial,
        });

        applyBehindBanner(botLogDelta.some(isRealBotTurnEntry), () => {
          setGameState(data as unknown as GameState);
          appendLog(newEntries);
        });
        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState, applyBehindBanner, appendLog]
  );

  const resolveSense = useCallback(
    (use: boolean) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.resolveSense(0, use) as SessionResult;
        if (data.error) { setError(data.error); return null; }
        const { playerLogDelta, botLogDelta } = session.consumeLogDeltas(0);

        const bName = botName.current;
        const pName = playerName.current;
        // No initial entry — the engine pushes "Used X to block mission
        // advance" via resolveSense when use=true, which is the meaningful
        // log line. The old "Sense defense active this turn" message was a
        // legacy of the per-turn pre-prompt flow and reads wrong now that
        // each advance prompts independently.
        const newEntries = buildTurnEntries({
          prevTurn: gameState.turnCount, data, playerLogDelta, botLogDelta, pName, bName,
        });

        applyBehindBanner(botLogDelta.some(isRealBotTurnEntry), () => {
          setGameState(data as unknown as GameState);
          appendLog(newEntries);
        });
        return data;
      } catch (e) { setError(String(e)); return null; }
    }, [gameState, applyBehindBanner, appendLog]
  );

  const resolveCloud = useCallback(
    (cardIds: number[]) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.resolveCloud(0, cardIds) as SessionResult;
        if (data.error) { setError(data.error); return null; }
        const { playerLogDelta, botLogDelta } = session.consumeLogDeltas(0);

        const bName = botName.current;
        const pName = playerName.current;
        const newEntries = buildTurnEntries({
          prevTurn: gameState.turnCount, data, playerLogDelta, botLogDelta, pName, bName,
        });

        applyBehindBanner(botLogDelta.some(isRealBotTurnEntry), () => {
          setGameState(data as unknown as GameState);
          appendLog(newEntries);
        });
        return data;
      } catch (e) { setError(String(e)); return null; }
    }, [gameState, applyBehindBanner, appendLog]
  );

  const resolveAllyDefense = useCallback(
    (cardId: number) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.resolveAllyDefense(0, cardId) as SessionResult;
        if (data.error) { setError(data.error); return null; }
        const { playerLogDelta, botLogDelta } = session.consumeLogDeltas(0);

        const bName = botName.current;
        const pName = playerName.current;
        const newEntries = buildTurnEntries({
          prevTurn: gameState.turnCount, data, playerLogDelta, botLogDelta, pName, bName,
        });

        applyBehindBanner(botLogDelta.some(isRealBotTurnEntry), () => {
          setGameState(data as unknown as GameState);
          appendLog(newEntries);
        });
        return data;
      } catch (e) { setError(String(e)); return null; }
    }, [gameState, applyBehindBanner, appendLog]
  );

  const undo = useCallback(() => {
    const session = sessionRef.current;
    if (!session || !session.canUndo()) return;

    // Read the externalData tag (rawLog length) off the snapshot at the top
    // of the undo stack — i.e. the one undo() is about to restore.
    const targetLen = session.peekUndoData();

    const ok = session.undo();
    if (!ok) return;

    setGameState(session.getState(0) as unknown as GameState);
    if (typeof targetLen === "number") truncateLog(targetLen);
  }, [truncateLog]);

  const refreshState = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    setGameState(session.getState(0) as unknown as GameState);
  }, []);

  const writeMatchIfNeeded = useCallback(async () => {
    if (matchWrittenRef.current) return;
    const session = sessionRef.current;
    const meta = matchMetaRef.current;
    if (!session || !meta || !session.game.winner) return;
    matchWrittenRef.current = true;

    // Resolve missing profileId: createGame may run before useAuth's
    // profile query has returned, leaving humanIdentity.profileId="".
    // If we have a userId, look up the profile so the row lands clean.
    let humanIdentity = meta.humanIdentity;
    if (!humanIdentity.profileId && humanIdentity.userId) {
      try {
        const result = await db.queryOnce({
          profiles: { $: { where: { odib: humanIdentity.userId } } },
        });
        const profile = (result.data?.profiles?.[0]) as { id: string } | undefined;
        if (profile?.id) humanIdentity = { ...humanIdentity, profileId: profile.id };
      } catch (e) {
        console.error("Profile lookup failed for match log; continuing without profileId:", e);
      }
    }

    const bot = botIdentity(meta.botStrategy);
    await saveMatchRecord({
      session,
      kind: "bot",
      botStrategy: meta.botStrategy,
      startedAt: meta.startedAt,
      testDeck: meta.testDeck,
      identities: [humanIdentity, bot],
    });
  }, []);

  // Write the match record exactly once, as soon as the phase resolves to
  // game_over — covers natural ends and the forfeit() path below.
  useEffect(() => {
    if (gameState?.phase === "game_over") void writeMatchIfNeeded();
  }, [gameState?.phase, writeMatchIfNeeded]);

  /** Mark the human as the forfeiter, end the game, and persist the record. */
  const forfeit = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.phase === "game_over") return;
    session.forfeit(0); // human is always player 0 in bot games
    setGameState(session.getState(0) as unknown as GameState);
    await writeMatchIfNeeded();
  }, [writeMatchIfNeeded]);

  return {
    gameState,
    loading,
    error,
    log,
    flashQueue,
    consumeFlash,
    recap,
    consumeRecap,
    banner,
    consumeBanner,
    createGame,
    playAction,
    advanceAllMission,
    playTwoActions,
    assignDamage,
    resolveSense,
    resolveCloud,
    resolveAllyDefense,
    respondToPrompt,
    refreshState,
    undo,
    canUndo: gameState?.canUndo ?? false,
    forfeit,
  };
}
