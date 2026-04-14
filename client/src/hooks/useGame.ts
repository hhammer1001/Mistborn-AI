import { useState, useCallback, useRef } from "react";
import type { GameState, GameAction } from "../types/game";
import { GameSession } from "../engine/session";
import { resetCardIds } from "../engine/card";

export interface LogEntry {
  turn: number;
  text: string;
  isBot?: boolean;
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
  const [log, setLog] = useState<LogEntry[]>([]);
  const playerName = useRef("Player");
  const botName = useRef("Bot");
  const sessionRef = useRef<GameSession | null>(null);

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
      setLog([]);
      playerName.current = pName;
      botName.current = `${opponentType.charAt(0).toUpperCase() + opponentType.slice(1)} Bot`;

      try {
        resetCardIds();
        const session = new GameSession({
          playerName: pName,
          character,
          opponentType,
          opponentCharacter,
          botFirst,
          testDeck,
        });
        sessionRef.current = session;
        const data = session.getState() as GameState;
        setGameState(data);

        const initLog: LogEntry[] = [{ turn: 1, text: "Game started" }];
        const bName = `${opponentType.charAt(0).toUpperCase() + opponentType.slice(1)} Bot`;
        if (data.botLog && data.botLog.length > 0) {
          initLog.push({ turn: 1, text: `${bName}'s turn`, isBot: true });
          for (const entry of data.botLog) {
            initLog.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true });
          }
        }
        if (data.turnCount > 1) {
          initLog.push({ turn: data.turnCount, text: `${pName}'s turn` });
        }
        setLog(initLog);
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
        const data = session.playAction(actionIndex);
        if (data.error) { setError(data.error); return null; }
        setGameState(data as GameState);

        const newEntries: LogEntry[] = [
          { turn: prevTurn, text: `${pName} — ${desc}` },
        ];

        const newTurnPlayerLogs: LogEntry[] = [];
        if (data.playerLog && data.playerLog.length > 0) {
          for (const entry of data.playerLog) {
            if (entry.turn > prevTurn) {
              newTurnPlayerLogs.push({ turn: entry.turn, text: `  → ${entry.text}` });
            } else {
              newEntries.push({ turn: entry.turn, text: `  → ${entry.text}` });
            }
          }
        }

        if (data.botLog && data.botLog.length > 0) {
          const botTurn = data.botLog[0]?.turn ?? prevTurn + 1;
          newEntries.push({ turn: botTurn, text: `${bName}'s turn`, isBot: true });
          for (const entry of data.botLog) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true });
          }
        }

        if (data.turnCount > prevTurn) {
          newEntries.push({ turn: data.turnCount, text: `${pName}'s turn` });
        }
        newEntries.push(...newTurnPlayerLogs);

        setLog((prev) => consolidateLog([...prev, ...newEntries]));
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
      let current = gameState;
      while (current) {
        const action = current.availableActions.find(
          (a) => a.code === 1 && a.missionName === missionName
        );
        if (!action) break;
        const result = playAction(action.index);
        if (!result || result.phase === "game_over") break;
        current = result as GameState;
      }
    },
    [gameState, playAction]
  );

  const playTwoActions = useCallback(
    (firstIndex: number, findSecond: (actions: GameAction[]) => number | undefined) => {
      const first = playAction(firstIndex);
      if (!first) return null;
      const secondIndex = findSecond(first.availableActions);
      if (secondIndex === undefined) return first;
      return playAction(secondIndex);
    },
    [playAction]
  );

  const respondToPrompt = useCallback(
    (promptType: string, value: number) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.respondToPrompt(promptType, value);
        if (data.error) { setError(data.error); return null; }
        setGameState(data as GameState);

        const newEntries: LogEntry[] = [];
        const bName = botName.current;
        const pName = playerName.current;

        if (data.playerLog && data.playerLog.length > 0) {
          for (const entry of data.playerLog) {
            newEntries.push({ turn: entry.turn, text: `  → ${entry.text}` });
          }
        }

        if (data.botLog && data.botLog.length > 0) {
          const botTurn = data.botLog[0]?.turn ?? gameState.turnCount + 1;
          newEntries.push({ turn: botTurn, text: `${bName}'s turn`, isBot: true });
          for (const entry of data.botLog) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true });
          }
        }

        if (data.turnCount > gameState.turnCount) {
          newEntries.push({ turn: data.turnCount, text: `${pName}'s turn` });
        }

        if (newEntries.length > 0) {
          setLog((prev) => consolidateLog([...prev, ...newEntries]));
        }

        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState]
  );

  const assignDamage = useCallback(
    (targetIndex: number) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.assignDamage(targetIndex);
        if (data.error) { setError(data.error); return null; }
        setGameState(data as GameState);

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

        if (data.playerLog && data.playerLog.length > 0) {
          for (const entry of data.playerLog) {
            newEntries.push({ turn: entry.turn, text: `  → ${entry.text}` });
          }
        }

        if (data.botLog && data.botLog.length > 0) {
          const botTurn = data.botLog[0]?.turn ?? gameState.turnCount + 1;
          newEntries.push({ turn: botTurn, text: `${bName}'s turn`, isBot: true });
          for (const entry of data.botLog) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true });
          }
        }

        if (data.turnCount > gameState.turnCount) {
          newEntries.push({ turn: data.turnCount, text: `${pName}'s turn` });
        }

        if (newEntries.length > 0) {
          setLog((prev) => consolidateLog([...prev, ...newEntries]));
        }

        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState]
  );

  const resolveSense = useCallback(
    (use: boolean) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.resolveSense(use);
        if (data.error) { setError(data.error); return null; }
        setGameState(data as GameState);

        const newEntries: LogEntry[] = [];
        const bName = botName.current;
        const pName = playerName.current;

        if (use) {
          newEntries.push({ turn: gameState.turnCount, text: `${pName} — Sense defense active this turn` });
        }

        if (data.playerLog?.length) {
          for (const entry of data.playerLog) {
            newEntries.push({ turn: entry.turn, text: `  → ${entry.text}` });
          }
        }
        if (data.botLog?.length) {
          const botTurn = data.botLog[0]?.turn ?? gameState.turnCount;
          newEntries.push({ turn: botTurn, text: `${bName}'s turn`, isBot: true });
          for (const entry of data.botLog) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true });
          }
        }
        if (data.turnCount > gameState.turnCount) {
          newEntries.push({ turn: data.turnCount, text: `${pName}'s turn` });
        }
        if (newEntries.length > 0) setLog((prev) => consolidateLog([...prev, ...newEntries]));
        return data;
      } catch (e) { setError(String(e)); return null; }
    }, [gameState]
  );

  const resolveCloud = useCallback(
    (cardId: number) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.resolveCloud(cardId);
        if (data.error) { setError(data.error); return null; }
        setGameState(data as GameState);

        const newEntries: LogEntry[] = [];
        const bName = botName.current;
        const pName = playerName.current;

        if (data.playerLog?.length) {
          for (const entry of data.playerLog) {
            newEntries.push({ turn: entry.turn, text: `  → ${entry.text}` });
          }
        }
        if (data.botLog?.length) {
          for (const entry of data.botLog) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true });
          }
        }
        if (data.turnCount > gameState.turnCount) {
          newEntries.push({ turn: data.turnCount, text: `${pName}'s turn` });
        }
        if (newEntries.length > 0) setLog((prev) => consolidateLog([...prev, ...newEntries]));
        return data;
      } catch (e) { setError(String(e)); return null; }
    }, [gameState]
  );

  const undo = useCallback(() => {
    const session = sessionRef.current;
    if (!session || !session.canUndo()) return;

    // Get the action history minus the last action, then rebuild
    const history = session.getActionHistory();
    history.pop(); // remove last action

    // Recreate session with same parameters
    resetCardIds();
    const newSession = new GameSession({
      playerName: playerName.current,
      character: session.character,
      opponentType: session.opponentType,
      opponentCharacter: session.opponentCharacter,
      botFirst: true, // matches original creation
    });

    // Replay all actions except the last
    for (const idx of history) {
      newSession.playAction(idx);
    }

    sessionRef.current = newSession;
    const data = newSession.getState() as GameState;
    setGameState(data);

    // Rebuild log (simplified: just show current state)
    setLog((prev) => {
      // Remove last player action entry
      const result = [...prev];
      // Find and remove the last non-bot entry
      for (let i = result.length - 1; i >= 0; i--) {
        if (!result[i].isBot) {
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
    setGameState(session.getState() as GameState);
  }, []);

  return {
    gameState,
    loading,
    error,
    log,
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
