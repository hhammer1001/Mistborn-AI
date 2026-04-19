import { useState, useCallback, useRef, useMemo } from "react";
import type { GameState, GameAction, BotLogEntry, PlayerData } from "../types/game";
import { GameSession, opponentTypeToKind } from "../engine/session";
import { resetCardIds } from "../engine/card";
import { useTurnSideEffects, computeRecap, type TurnRecap } from "./useTurnSideEffects";

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
      testDeck: boolean = false
    ) => {
      setLoading(true);
      setError(null);
      setRawLog([]);
      clearRecapEntries();
      playerName.current = pName;
      botName.current = `${opponentType.charAt(0).toUpperCase() + opponentType.slice(1)} Bot`;

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
        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState]
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
      // Wrap both plays so a single undo rolls back the whole composite.
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

        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState, applyBehindBanner]
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

        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState, applyBehindBanner]
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
        return data;
      } catch (e) { setError(String(e)); return null; }
    }, [gameState, applyBehindBanner]
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
        return data;
      } catch (e) { setError(String(e)); return null; }
    }, [gameState, applyBehindBanner]
  );

  const undo = useCallback(() => {
    const session = sessionRef.current;
    if (!session || !session.canUndo()) return;

    const pName = playerName.current;

    // Restore in place — session handles state rollback and log cleanup.
    const ok = session.undo();
    if (!ok) return;

    const data = session.getState(0) as unknown as GameState;
    setGameState(data);

    // Session's own log entry was removed by undo() — also remove the matching
    // "Player — <action description>" line from the hook-side log.
    setRawLog((prev) => {
      const result = [...prev];
      for (let i = result.length - 1; i >= 0; i--) {
        if (!result[i].isBot && result[i].text.startsWith(`${pName} — `)) {
          result.splice(i, 1);
          break;
        }
      }
      return result;
    });
  }, []);

  const refreshState = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    setGameState(session.getState(0) as unknown as GameState);
  }, []);

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
  };
}
