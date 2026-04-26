import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { GameState, GameAction, BotLogEntry, PlayerData } from "../types/game";
import { GameSession, opponentTypeToKind } from "../engine/session";
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
  actionType?: string;
  metalIndex?: number;
  recap?: TurnRecap;
}

/** A reactive entry is a defense (Sense / Cloud) that fires during the
 *  other player's action, not a turn-taking action. Used to suppress the
 *  "bot's turn" header when the delta contains only reactive entries. */
function isRealBotTurnEntry(e: BotLogEntry): boolean {
  if (!e.actionType) return false;
  return e.actionType !== "sense_block" && e.actionType !== "cloud_block";
}

/** Strip trailing " (×N)" to get the base text for comparison */
function baseText(text: string): string {
  return text.replace(/\s*\(×\d+\)$/, "");
}

/** Merge consecutive identical entries into "X (×N)" */
function consolidateLog(entries: LogEntry[]): LogEntry[] {
  const result: LogEntry[] = [];
  for (const entry of entries) {
    const last = result[result.length - 1];
    if (last && baseText(last.text) === baseText(entry.text) && last.turn === entry.turn && last.isBot === entry.isBot) {
      const match = last.text.match(/^(.*?)(?:\s*\(×(\d+)\))?$/);
      if (match) {
        const base = match[1];
        const count = parseInt(match[2] ?? "1") + 1;
        last.text = `${base} (×${count})`;
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

  // Stack of rawLog lengths parallel to session._undoStack. Each entry is the
  // rawLog.length BEFORE a user-initiated undoable sequence began; on undo we
  // pop and slice rawLog back to it. This handles single actions, prompt-driven
  // actions (where the engine pushes only on prompt resolution), and composite
  // playTwoActions (one engine entry, multiple hook entries) uniformly.
  const undoLogLensRef = useRef<number[]>([]);
  const pendingPushLenRef = useRef<number | null>(null);
  const inCompositeRef = useRef(false);

  /** Reconcile undoLogLensRef to the engine's current undo stack length.
   *  When the engine's stack grows, push pendingPushLenRef (the rawLog length
   *  captured before the operation that caused the growth). When it shrinks
   *  (undo, end_actions clearing it), pop.
   *
   *  pendingPushLenRef is only cleared after we actually consume it for a
   *  push — otherwise a prompt-triggering playAction (which doesn't grow the
   *  stack until respondToPrompt completes) would lose its captured length. */
  const syncUndoLogLens = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const target = session.undoStackLength();
    while (undoLogLensRef.current.length > target) undoLogLensRef.current.pop();
    if (undoLogLensRef.current.length < target) {
      while (undoLogLensRef.current.length < target) {
        undoLogLensRef.current.push(pendingPushLenRef.current ?? 0);
      }
      pendingPushLenRef.current = null;
    }
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
  const { flashQueue, recap, banner, recapEntries, consumeFlash, consumeRecap, consumeBanner, clearRecapEntries, setBanner, pushRecap, flagExpectYourBanner } = sideEffects;

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
      humanIdentity: MatchIdentity = { profileId: "", userId: "", name: pName }
    ) => {
      setLoading(true);
      setError(null);
      setRawLog([]);
      clearRecapEntries();
      undoLogLensRef.current = [];
      pendingPushLenRef.current = null;
      inCompositeRef.current = false;
      playerName.current = pName;
      botName.current = `${opponentType.charAt(0).toUpperCase() + opponentType.slice(1)} Bot`;

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
            { kind: botKind, name: `${opponentType.charAt(0).toUpperCase() + opponentType.slice(1)} Bot`, character: opponentCharacter },
          ],
          firstPlayer: botFirst ? 1 : 0,
          testDeck,
        });
        sessionRef.current = session;
        const data = session.getState(0) as unknown as GameState;
        setGameState(data);

        // Consume the initial log deltas (bot-first turn produces bot-log entries).
        const { botLogDelta } = session.consumeLogDeltas(0);

        const initLog: LogEntry[] = [{ turn: 1, text: "Game started" }];
        const bName = `${opponentType.charAt(0).toUpperCase() + opponentType.slice(1)} Bot`;
        if (botLogDelta.length > 0) {
          if (botLogDelta.some(isRealBotTurnEntry)) {
            initLog.push({ turn: 1, text: `${bName}'s turn`, isBot: true });
          }
          for (const entry of botLogDelta) {
            initLog.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
          }
          // Flashes are derived declaratively by useTurnSideEffects from the
          // initial gameState. Recap has no prior snapshot to diff against, so
          // synthesize one from the engine's starting-HP rule (player.ts:54,
          // `36 + 2 * turnOrder`, uniform across characters) + zero training /
          // mission ranks / allies, then push imperatively.
          const startHp = (p: PlayerData) => 36 + 2 * p.turnOrder;
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
    (actionIndex: number) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      const action = gameState.availableActions.find((a) => a.index === actionIndex);
      const desc = action?.description ?? `Action ${actionIndex}`;
      const prevTurn = gameState.turnCount;
      const pName = playerName.current;
      const bName = botName.current;

      setError(null);

      // Capture rawLog length before this action so undo can slice back to it.
      // Inside a composite (playTwoActions), the outer wrapper owns this.
      if (!inCompositeRef.current) pendingPushLenRef.current = rawLog.length;

      try {
        const data = session.playAction(0, actionIndex) as SessionResult;
        if (data.error) { setError(data.error); return null; }
        const { playerLogDelta, botLogDelta } = session.consumeLogDeltas(0);

        const newEntries: LogEntry[] = [
          { turn: prevTurn, text: `${pName} — ${desc}` },
        ];

        const newTurnPlayerLogs: LogEntry[] = [];
        if (playerLogDelta.length > 0) {
          for (const entry of playerLogDelta) {
            if (entry.turn > prevTurn) {
              newTurnPlayerLogs.push({ turn: entry.turn, text: `  → ${entry.text}`, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
            } else {
              newEntries.push({ turn: entry.turn, text: `  → ${entry.text}`, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
            }
          }
        }

        if (botLogDelta.length > 0) {
          const botTurn = botLogDelta[0]?.turn ?? prevTurn + 1;
          if (botLogDelta.some(isRealBotTurnEntry)) {
            newEntries.push({ turn: botTurn, text: `${bName}'s turn`, isBot: true });
          }
          for (const entry of botLogDelta) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
          }
        }

        if ((data.turnCount ?? 0) > prevTurn) {
          newEntries.push({ turn: data.turnCount!, text: `${pName}'s turn` });
        }
        newEntries.push(...newTurnPlayerLogs);

        // If the bot actually played, defer the gameState update behind the
        // "opponent's turn" banner so the transition feels like a hand-off.
        // End-actions that just enter damage phase (no bot entries) skip this.
        applyBehindBanner(botLogDelta.some(isRealBotTurnEntry), () => {
          setGameState(data as unknown as GameState);
          setRawLog((prev) => consolidateLog([...prev, ...newEntries]));
        });
        if (!inCompositeRef.current) syncUndoLogLens();
        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState, syncUndoLogLens, applyBehindBanner, rawLog]
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
      // Composite collapses to one engine undo entry; capture rawLog length
      // before the first play so undo rolls back BOTH inner action's hook
      // entries together.
      pendingPushLenRef.current = rawLog.length;
      inCompositeRef.current = true;
      session.beginUndoBatch();
      try {
        const first = playAction(firstIndex) as unknown as SessionResult | null;
        if (!first) return null;
        const actions = (first.availableActions ?? []) as GameAction[];
        const second = actions.find((a) => a.code === secondMatch.code
          && (secondMatch.cardIds === undefined || (a.cardId !== undefined && secondMatch.cardIds.includes(a.cardId))));
        if (!second) return first;
        return playAction(second.index);
      } finally {
        session.endUndoBatch();
        inCompositeRef.current = false;
        syncUndoLogLens();
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

        const newEntries: LogEntry[] = [];
        const bName = botName.current;
        const pName = playerName.current;

        if (playerLogDelta.length > 0) {
          for (const entry of playerLogDelta) {
            newEntries.push({ turn: entry.turn, text: `  → ${entry.text}`, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
          }
        }

        if (botLogDelta.length > 0) {
          const botTurn = botLogDelta[0]?.turn ?? gameState.turnCount + 1;
          if (botLogDelta.some(isRealBotTurnEntry)) {
            newEntries.push({ turn: botTurn, text: `${bName}'s turn`, isBot: true });
          }
          for (const entry of botLogDelta) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
          }
        }

        if ((data.turnCount ?? 0) > gameState.turnCount) {
          newEntries.push({ turn: data.turnCount!, text: `${pName}'s turn` });
        }

        applyBehindBanner(botLogDelta.some(isRealBotTurnEntry), () => {
          setGameState(data as unknown as GameState);
          if (newEntries.length > 0) setRawLog((prev) => consolidateLog([...prev, ...newEntries]));
        });
        // Engine pushes the undo snapshot only when a prompted action completes
        // (not during the playAction that triggered the prompt). Sync here so
        // pendingPushLenRef — captured at that earlier playAction — lands on
        // the parallel stack at the right moment.
        syncUndoLogLens();
        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState, applyBehindBanner, syncUndoLogLens]
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

        const newEntries: LogEntry[] = [];
        const bName = botName.current;
        const pName = playerName.current;

        if (targetIndex === -1) {
          const dmg = gameState.players[0].damage;
          if (dmg > 0) {
            newEntries.push({ turn: gameState.turnCount, text: `${pName} dealt ${dmg} damage to ${bName}` });
          }
        } else if (targetIndex === -2) {
          // Skip: explicitly dealt no damage this turn. No log entry needed.
        } else {
          const target = gameState.damageTargets?.find((t) => t.index === targetIndex);
          newEntries.push({ turn: gameState.turnCount, text: `${pName} killed ${target?.name ?? "ally"} (${target?.health ?? "?"} HP)` });
        }

        if (playerLogDelta.length > 0) {
          for (const entry of playerLogDelta) {
            newEntries.push({ turn: entry.turn, text: `  → ${entry.text}`, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
          }
        }

        if (botLogDelta.length > 0) {
          const botTurn = botLogDelta[0]?.turn ?? gameState.turnCount + 1;
          if (botLogDelta.some(isRealBotTurnEntry)) {
            newEntries.push({ turn: botTurn, text: `${bName}'s turn`, isBot: true });
          }
          for (const entry of botLogDelta) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
          }
        }

        if ((data.turnCount ?? 0) > gameState.turnCount) {
          newEntries.push({ turn: data.turnCount!, text: `${pName}'s turn` });
        }

        applyBehindBanner(botLogDelta.some(isRealBotTurnEntry), () => {
          setGameState(data as unknown as GameState);
          if (newEntries.length > 0) setRawLog((prev) => consolidateLog([...prev, ...newEntries]));
        });
        // Damage phase doesn't produce undo entries, but end_actions clears
        // the engine's stack — sync so the parallel stack drains too.
        syncUndoLogLens();
        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState, applyBehindBanner, syncUndoLogLens]
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

        const newEntries: LogEntry[] = [];
        const bName = botName.current;
        const pName = playerName.current;

        if (use) {
          newEntries.push({ turn: gameState.turnCount, text: `${pName} — Sense defense active this turn` });
        }

        if (playerLogDelta.length) {
          for (const entry of playerLogDelta) {
            newEntries.push({ turn: entry.turn, text: `  → ${entry.text}`, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
          }
        }
        if (botLogDelta.length) {
          const botTurn = botLogDelta[0]?.turn ?? gameState.turnCount;
          if (botLogDelta.some(isRealBotTurnEntry)) {
            newEntries.push({ turn: botTurn, text: `${bName}'s turn`, isBot: true });
          }
          for (const entry of botLogDelta) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
          }
        }
        if ((data.turnCount ?? 0) > gameState.turnCount) {
          newEntries.push({ turn: data.turnCount!, text: `${pName}'s turn` });
        }
        applyBehindBanner(botLogDelta.some(isRealBotTurnEntry), () => {
          setGameState(data as unknown as GameState);
          if (newEntries.length > 0) setRawLog((prev) => consolidateLog([...prev, ...newEntries]));
        });
        syncUndoLogLens();
        return data;
      } catch (e) { setError(String(e)); return null; }
    }, [gameState, applyBehindBanner, syncUndoLogLens]
  );

  const resolveCloud = useCallback(
    (cardId: number) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.resolveCloud(0, cardId) as SessionResult;
        if (data.error) { setError(data.error); return null; }
        const { playerLogDelta, botLogDelta } = session.consumeLogDeltas(0);

        const newEntries: LogEntry[] = [];
        const bName = botName.current;
        const pName = playerName.current;

        if (playerLogDelta.length) {
          for (const entry of playerLogDelta) {
            newEntries.push({ turn: entry.turn, text: `  → ${entry.text}`, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
          }
        }
        if (botLogDelta.length) {
          for (const entry of botLogDelta) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
          }
        }
        if ((data.turnCount ?? 0) > gameState.turnCount) {
          newEntries.push({ turn: data.turnCount!, text: `${pName}'s turn` });
        }
        applyBehindBanner(botLogDelta.some(isRealBotTurnEntry), () => {
          setGameState(data as unknown as GameState);
          if (newEntries.length > 0) setRawLog((prev) => consolidateLog([...prev, ...newEntries]));
        });
        syncUndoLogLens();
        return data;
      } catch (e) { setError(String(e)); return null; }
    }, [gameState, applyBehindBanner, syncUndoLogLens]
  );

  const undo = useCallback(() => {
    const session = sessionRef.current;
    if (!session || !session.canUndo()) return;

    // Read the rawLog length captured before the action being undone, then
    // pop it off the parallel stack (session.undo drops the engine entry).
    const targetLen = undoLogLensRef.current[undoLogLensRef.current.length - 1];

    const ok = session.undo();
    if (!ok) return;

    const data = session.getState(0) as unknown as GameState;
    setGameState(data);
    syncUndoLogLens();

    if (typeof targetLen === "number") {
      setRawLog((prev) => prev.slice(0, targetLen));
    }
  }, [syncUndoLogLens]);

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
    respondToPrompt,
    refreshState,
    undo,
    canUndo: gameState?.canUndo ?? false,
    forfeit,
  };
}
