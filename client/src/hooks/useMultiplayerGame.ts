import { useState, useCallback, useMemo } from "react";
import { db } from "../lib/instantdb";
import type { GameState, GameAction } from "../types/game";
import type { LogEntry } from "./useGame";

const API_BASE = "";

/**
 * Multiplayer game hook. State comes from InstantDB subscription;
 * actions are sent to the server API which updates InstantDB.
 */
export function useMultiplayerGame(
  sessionId: string | null,
  userId: string | null,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to the game record in InstantDB
  const gameQuery = db.useQuery(
    sessionId ? { games: { $: { where: { id: sessionId } } } } : null
  );

  const gameRecord = gameQuery.data?.games?.[0] as Record<string, unknown> | undefined;

  // Derive my player index and game state from the record
  const myPlayerIndex = useMemo(() => {
    if (!gameRecord || !userId) return null;
    if (gameRecord.p0Id === userId) return 0;
    if (gameRecord.p1Id === userId) return 1;
    return null;
  }, [gameRecord, userId]);

  const gameState = useMemo<GameState | null>(() => {
    if (!gameRecord || myPlayerIndex === null) return null;
    const stateField = myPlayerIndex === 0 ? "p0State" : "p1State";
    const state = gameRecord[stateField] as GameState | undefined;
    if (!state) return null;
    return {
      ...state,
      sessionId: sessionId!,
    };
  }, [gameRecord, myPlayerIndex, sessionId]);

  const isMyTurn = gameState?.isMyTurn ?? false;

  // Build log from cumulative server logs
  const log = useMemo<LogEntry[]>(() => {
    if (!gameState) return [];
    const entries: LogEntry[] = [];
    const playerLog = gameState.playerLog ?? [];
    const botLog = gameState.botLog ?? [];

    for (const entry of playerLog) {
      entries.push({ turn: entry.turn, text: entry.text, isBot: false });
    }
    for (const entry of botLog) {
      entries.push({ turn: entry.turn, text: entry.text, isBot: true });
    }
    entries.sort((a, b) => a.turn - b.turn);
    return entries;
  }, [gameState]);

  // ── Action senders ──

  /** Post to a multiplayer endpoint; returns the response JSON. */
  const _post = useCallback(
    async (endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      if (!sessionId || !userId) return null;
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`${API_BASE}/api/multiplayer/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, playerId: userId, ...body }),
        });
        const data = await resp.json();
        if (data.error) {
          setError(data.error);
          return null;
        }
        return data;
      } catch (e) {
        setError(String(e));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [sessionId, userId]
  );

  /** Play an action. Returns the server's immediate state response (for chaining). */
  const _playActionRaw = useCallback(
    async (actionIndex: number): Promise<GameState | null> => {
      const data = await _post("action", { actionIndex });
      return (data?.state as GameState) ?? null;
    },
    [_post]
  );

  const playAction = useCallback(
    (actionIndex: number) => { _playActionRaw(actionIndex); },
    [_playActionRaw]
  );

  const advanceAllMission = useCallback(
    async (missionName: string) => {
      if (!gameState) return;
      let current: GameState | null = gameState;
      while (current) {
        const action = current.availableActions.find(
          (a) => a.code === 1 && a.missionName === missionName
        );
        if (!action) break;
        current = await _playActionRaw(action.index);
        if (!current || current.phase === "game_over") break;
      }
    },
    [gameState, _playActionRaw]
  );

  const playTwoActions = useCallback(
    async (firstIndex: number, findSecond: (actions: GameAction[]) => number | undefined) => {
      if (!gameState) return;
      // Run findSecond against a dummy to extract what it's looking for,
      // then use the composite endpoint so both actions happen in one server call.
      // To get the matcher, we peek at what findSecond would match by running it
      // against the current actions with the first action removed.
      // But we can't know the exact new actions list without the server.
      // So: use the single action endpoint to get the intermediate state,
      // then fire the second action. Both are fast since the first already saved.
      const afterFirst = await _playActionRaw(firstIndex);
      if (!afterFirst) return;
      const secondIndex = findSecond(afterFirst.availableActions);
      if (secondIndex === undefined) return;
      // Second action uses the already-saved state, so just one more call
      await _playActionRaw(secondIndex);
    },
    [gameState, _playActionRaw]
  );

  const respondToPrompt = useCallback(
    (promptType: string, value: number) =>
      _post("prompt", { promptType, value }),
    [_post]
  );

  const assignDamage = useCallback(
    (targetIndex: number) => _post("damage", { targetIndex }),
    [_post]
  );

  const resolveSense = useCallback(
    (use: boolean) => _post("sense", { use }),
    [_post]
  );

  const resolveCloud = useCallback(
    (cardId: number) => _post("cloud", { cardId }),
    [_post]
  );

  const forfeit = useCallback(() => _post("forfeit", {}), [_post]);

  return {
    gameState,
    loading: loading || gameQuery.isLoading,
    error,
    log,
    isMyTurn,
    myPlayerIndex,
    playAction,
    advanceAllMission,
    playTwoActions,
    assignDamage,
    resolveSense,
    resolveCloud,
    respondToPrompt,
    forfeit,
  };
}
