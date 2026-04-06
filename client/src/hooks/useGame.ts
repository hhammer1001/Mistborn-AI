import { useState, useCallback } from "react";
import type { GameState } from "../types/game";

const API_BASE = "";

export function useGame() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createGame = useCallback(
    async (
      playerName: string,
      character: string,
      opponentType: string,
      opponentCharacter: string
    ) => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`${API_BASE}/api/games`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerName,
            character,
            opponentType,
            opponentCharacter,
          }),
        });
        const data: GameState = await resp.json();
        setGameState(data);
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
    createGame,
    playAction,
    refreshState,
  };
}
