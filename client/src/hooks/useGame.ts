import { useState, useCallback, useRef } from "react";
import type { GameState, GameAction } from "../types/game";

const API_BASE = "";

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

  const createGame = useCallback(
    async (
      pName: string,
      character: string,
      opponentType: string,
      opponentCharacter: string
    ) => {
      setLoading(true);
      setError(null);
      setLog([]);
      playerName.current = pName;
      botName.current = `${opponentType.charAt(0).toUpperCase() + opponentType.slice(1)} Bot`;
      try {
        const resp = await fetch(`${API_BASE}/api/games`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerName: pName,
            character,
            opponentType,
            opponentCharacter,
          }),
        });
        const data: GameState = await resp.json();
        setGameState(data);
        setLog([{ turn: data.turnCount, text: "Game started" }]);
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
    async (actionIndex: number) => {
      if (!gameState) return null;
      const action = gameState.availableActions.find((a) => a.index === actionIndex);
      const desc = action?.description ?? `Action ${actionIndex}`;
      const prevTurn = gameState.turnCount;
      const pName = playerName.current;
      const bName = botName.current;

      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(
          `${API_BASE}/api/games/${gameState.sessionId}/action`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ actionIndex }),
          }
        );
        const data = await resp.json();
        if (data.error) {
          setError(data.error);
          return null;
        }
        setGameState(data as GameState);

        const newEntries: LogEntry[] = [
          { turn: prevTurn, text: `${pName} — ${desc}` },
        ];

        // Player effect logs for THIS turn (abilities, buys, etc.)
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

        // If bot log entries came back, add them
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
        // Append new-turn player logs after the turn header
        newEntries.push(...newTurnPlayerLogs);

        setLog((prev) => consolidateLog([...prev, ...newEntries]));

        return data;
      } catch (e) {
        setError(String(e));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [gameState]
  );

  const playTwoActions = useCallback(
    async (firstIndex: number, findSecond: (actions: GameAction[]) => number | undefined) => {
      const first = await playAction(firstIndex);
      if (!first) return null;
      const secondIndex = findSecond(first.availableActions);
      if (secondIndex === undefined) return first;
      // Fire the second action directly against the API with the fresh session
      setLoading(true);
      try {
        const resp = await fetch(
          `${API_BASE}/api/games/${first.sessionId}/action`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ actionIndex: secondIndex }),
          }
        );
        const data = await resp.json();
        if (data.error) { setError(data.error); return null; }
        setGameState(data as GameState);
        return data;
      } catch (e) {
        setError(String(e));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [playAction]
  );

  const respondToPrompt = useCallback(
    async (promptType: string, value: number) => {
      if (!gameState) return null;
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(
          `${API_BASE}/api/games/${gameState.sessionId}/prompt`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ promptType, value }),
          }
        );
        const data = await resp.json();
        if (data.error) { setError(data.error); return null; }
        setGameState(data as GameState);

        // Log bot actions if turn advanced
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
      } finally {
        setLoading(false);
      }
    },
    [gameState]
  );

  const assignDamage = useCallback(
    async (targetIndex: number) => {
      if (!gameState) return null;
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(
          `${API_BASE}/api/games/${gameState.sessionId}/damage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetIndex }),
          }
        );
        const data = await resp.json();
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
      } finally {
        setLoading(false);
      }
    },
    [gameState]
  );

  const resolveSense = useCallback(
    async (use: boolean) => {
      if (!gameState) return null;
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(
          `${API_BASE}/api/games/${gameState.sessionId}/sense`,
          { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ use }) }
        );
        const data = await resp.json();
        if (data.error) { setError(data.error); return null; }
        setGameState(data as GameState);

        const newEntries: LogEntry[] = [];
        const bName = botName.current;
        const pName = playerName.current;

        if (use) {
          newEntries.push({ turn: gameState.turnCount, text: `${pName} — Sense defense active this turn` });
        }

        if (data.playerLog && data.playerLog.length > 0) {
          for (const entry of data.playerLog) {
            newEntries.push({ turn: entry.turn, text: `  → ${entry.text}` });
          }
        }
        if (data.botLog && data.botLog.length > 0) {
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
      finally { setLoading(false); }
    }, [gameState]
  );

  const resolveCloud = useCallback(
    async (cardId: number) => {
      if (!gameState) return null;
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(
          `${API_BASE}/api/games/${gameState.sessionId}/cloud`,
          { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cardId }) }
        );
        const data = await resp.json();
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
      finally { setLoading(false); }
    }, [gameState]
  );

  const refreshState = useCallback(async () => {
    if (!gameState) return;
    try {
      const resp = await fetch(
        `${API_BASE}/api/games/${gameState.sessionId}`
      );
      const data = await resp.json();
      if (data.error) { setError(data.error); return; }
      setGameState(data as GameState);
    } catch (e) {
      setError(String(e));
    }
  }, [gameState]);

  return {
    gameState,
    loading,
    error,
    log,
    createGame,
    playAction,
    playTwoActions,
    assignDamage,
    resolveSense,
    resolveCloud,
    respondToPrompt,
    refreshState,
  };
}
