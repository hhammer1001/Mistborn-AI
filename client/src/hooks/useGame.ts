import { useState, useCallback, useRef } from "react";
import type { GameState } from "../types/game";

const API_BASE = "";

export interface LogEntry {
  turn: number;
  text: string;
  isBot?: boolean;
}

/** Merge consecutive identical entries into "X (×N)" */
function consolidateLog(entries: LogEntry[]): LogEntry[] {
  const result: LogEntry[] = [];
  for (const entry of entries) {
    const last = result[result.length - 1];
    if (last && last.text === entry.text && last.turn === entry.turn && last.isBot === entry.isBot) {
      // Extract existing count or start at 1
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
        const data: GameState = await resp.json();
        setGameState(data);

        const newEntries: LogEntry[] = [
          { turn: prevTurn, text: `${pName} — ${desc}` },
        ];

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
        const data: GameState = await resp.json();
        setGameState(data);

        // Log bot actions if turn advanced
        const newEntries: LogEntry[] = [];
        const bName = botName.current;
        const pName = playerName.current;

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

  const refreshState = useCallback(async () => {
    if (!gameState) return;
    try {
      const resp = await fetch(
        `${API_BASE}/api/games/${gameState.sessionId}`
      );
      const data: GameState = await resp.json();
      setGameState(data);
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
    respondToPrompt,
    refreshState,
  };
}
