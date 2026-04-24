import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { db } from "../lib/instantdb";
import type { GameState } from "../types/game";
import type { LogEntry } from "./useGame";
import { useTurnSideEffects } from "./useTurnSideEffects";
import { GameSession } from "../engine/session";
import { saveMatchRecord, type MatchIdentity } from "../lib/matchLog";

/**
 * Multiplayer game hook.
 *
 * Architecture: The HOST holds the GameSession in memory and
 * processes ALL actions (both host's and guest's). The guest writes action
 * requests to `pendingAction` in InstantDB. The host watches for these,
 * processes them, writes the new state, and clears the pending action.
 *
 * Both players read state from InstantDB subscriptions.
 */
export function useMultiplayerGame(
  sessionId: string | null,
  userId: string | null,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The HOST holds the session in memory
  const sessionRef = useRef<GameSession | null>(null);

  // Match-log: host writes exactly once at game_over.
  const matchWrittenRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);

  // Reset match-write state when the session changes (new game).
  useEffect(() => {
    matchWrittenRef.current = false;
    startedAtRef.current = null;
  }, [sessionId]);

  // Subscribe to the game record in InstantDB
  const gameQuery = db.useQuery(
    sessionId ? { games: { $: { where: { id: sessionId } } } } : null
  );

  const gameRecord = gameQuery.data?.games?.[0] as Record<string, unknown> | undefined;

  // Derive my player index
  const myPlayerIndex = useMemo(() => {
    if (!gameRecord || !userId) return null;
    if (gameRecord.p0Id === userId) return 0;
    if (gameRecord.p1Id === userId) return 1;
    return null;
  }, [gameRecord, userId]);

  const isHost = myPlayerIndex === 0;

  // Derive game state from InstantDB record
  const gameState = useMemo<GameState | null>(() => {
    if (!gameRecord || myPlayerIndex === null) return null;
    const stateField = myPlayerIndex === 0 ? "p0State" : "p1State";
    const state = gameRecord[stateField] as GameState | undefined;
    if (!state) return null;
    return { ...state, sessionId: sessionId! };
  }, [gameRecord, myPlayerIndex, sessionId]);

  const isMyTurn = gameState?.isMyTurn ?? false;

  // Flash queue / recap / banner state machine — declarative, derived from
  // gameState changes (new bot-log entries → flashes; isMyTurn transitions →
  // banner; before/after state diff on turn boundary → recap).
  const {
    flashQueue, recap, banner, recapEntries,
    consumeFlash, consumeRecap, consumeBanner,
  } = useTurnSideEffects({
    gameState,
    perspective: myPlayerIndex ?? 0,
    isMyTurn,
  });

  // Build log: cumulative engine logs from gameState + materialized recap
  // entries from the side-effects hook, sorted by turn.
  const log = useMemo<LogEntry[]>(() => {
    if (!gameState) return [];
    const entries: LogEntry[] = [];
    for (const entry of gameState.playerLog ?? []) {
      entries.push({ turn: entry.turn, text: entry.text, isBot: false, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
    }
    for (const entry of gameState.botLog ?? []) {
      entries.push({ turn: entry.turn, text: entry.text, isBot: true, card: entry.card, actionType: entry.actionType, metalIndex: entry.metalIndex });
    }
    entries.push(...recapEntries);
    entries.sort((a, b) => a.turn - b.turn);
    return entries;
  }, [gameState, recapEntries]);

  // ── Host: process pending guest actions ──

  useEffect(() => {
    if (!isHost || !sessionId || !gameRecord) return;
    const pending = gameRecord.pendingAction as Record<string, unknown> | null;
    if (!pending || !pending.actionType) return;

    const session = sessionRef.current;
    if (!session) return;

    // Process the pending action
    const pi = pending.playerIndex as number;

    try {
      switch (pending.actionType) {
        case "action":
          session.playAction(pi, pending.actionIndex as number);
          break;
        case "undo":
          // Guest requested undo. Only valid if it's still their turn and the
          // session's canUndo check passes (intra-turn, no info revealed).
          session.undo();
          break;
        case "composite": {
          // Two-step action (e.g. burn_card + use_metal). Atomic single undo.
          const match = pending.secondMatch as { code: number; cardIds?: number[] } | undefined;
          if (match) {
            session.playComposite(pi, pending.actionIndex as number, match);
          } else {
            session.playAction(pi, pending.actionIndex as number);
          }
          break;
        }
        case "advance_all":
          session.advanceAllMission(pi, pending.missionName as string);
          break;
        case "prompt":
          session.respondToPrompt(pi, pending.promptType as string, pending.value as number);
          break;
        case "damage":
          session.assignDamage(pi, pending.targetIndex as number);
          break;
        case "sense":
          session.resolveSense(pi, pending.use as boolean);
          break;
        case "cloud":
          session.resolveCloud(pi, pending.cardId as number);
          break;
        case "forfeit":
          session.forfeit(pi);
          break;
      }
    } catch (e) {
      console.error("Error processing guest action:", e);
    }

    // Write updated state and clear pending action
    const payload = session.getInstantDBPayload();
    db.transact(
      db.tx.games[sessionId].update({
        ...payload,
        pendingAction: null,
        stateVersion: ((gameRecord.stateVersion as number) ?? 0) + 1,
      })
    );
  }, [isHost, sessionId, gameRecord]);

  // ── Write helpers ──

  /** Host: run action locally and write to InstantDB */
  const _hostAction = useCallback(
    async (actionFn: (session: GameSession) => { error?: string } | null) => {
      const session = sessionRef.current;
      if (!session || !sessionId) {
        setError("Session not available");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = actionFn(session);
        if (result?.error) { setError(result.error); return; }
        const payload = session.getInstantDBPayload();
        await db.transact(
          db.tx.games[sessionId].update({
            ...payload,
            pendingAction: null,
            stateVersion: ((gameRecord?.stateVersion as number) ?? 0) + 1,
          })
        );
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [sessionId, gameRecord]
  );

  /** Guest: write a pending action request to InstantDB */
  const _guestAction = useCallback(
    async (action: Record<string, unknown>) => {
      if (!sessionId) return;
      setLoading(true);
      setError(null);
      try {
        await db.transact(
          db.tx.games[sessionId].update({
            pendingAction: { ...action, playerIndex: myPlayerIndex },
          })
        );
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [sessionId, myPlayerIndex]
  );

  // ── Action methods ──

  const playAction = useCallback(
    (actionIndex: number) => {
      if (myPlayerIndex === null) return;
      if (isHost) {
        _hostAction((s) => s.playAction(myPlayerIndex, actionIndex));
      } else {
        _guestAction({ actionType: "action", actionIndex });
      }
    },
    [isHost, myPlayerIndex, _hostAction, _guestAction]
  );

  const advanceAllMission = useCallback(
    async (missionName: string) => {
      if (myPlayerIndex === null) return;
      if (isHost) {
        const session = sessionRef.current;
        if (!session || !sessionId) return;
        session.advanceAllMission(myPlayerIndex, missionName);
        const payload = session.getInstantDBPayload();
        await db.transact(
          db.tx.games[sessionId].update({
            ...payload,
            pendingAction: null,
            stateVersion: ((gameRecord?.stateVersion as number) ?? 0) + 1,
          })
        );
      } else {
        await _guestAction({ actionType: "advance_all", missionName });
      }
    },
    [isHost, myPlayerIndex, sessionId, gameRecord, _guestAction]
  );

  const playTwoActions = useCallback(
    async (firstIndex: number, secondMatch: { code: number; cardIds?: number[] }) => {
      if (myPlayerIndex === null) return;
      if (isHost) {
        const session = sessionRef.current;
        if (!session || !sessionId) return;
        session.playComposite(myPlayerIndex, firstIndex, secondMatch);
        const payload = session.getInstantDBPayload();
        await db.transact(
          db.tx.games[sessionId].update({
            ...payload,
            pendingAction: null,
            stateVersion: ((gameRecord?.stateVersion as number) ?? 0) + 1,
          })
        );
      } else {
        // Guest: send composite request so host plays BOTH actions atomically.
        await _guestAction({ actionType: "composite", actionIndex: firstIndex, secondMatch });
      }
    },
    [isHost, myPlayerIndex, sessionId, gameRecord, _guestAction]
  );

  const respondToPrompt = useCallback(
    (promptType: string, value: number) => {
      if (myPlayerIndex === null) return;
      if (isHost) {
        _hostAction((s) => s.respondToPrompt(myPlayerIndex, promptType, value));
      } else {
        _guestAction({ actionType: "prompt", promptType, value });
      }
    },
    [isHost, myPlayerIndex, _hostAction, _guestAction]
  );

  const assignDamage = useCallback(
    (targetIndex: number) => {
      if (myPlayerIndex === null) return;
      if (isHost) {
        _hostAction((s) => s.assignDamage(myPlayerIndex, targetIndex));
      } else {
        _guestAction({ actionType: "damage", targetIndex });
      }
    },
    [isHost, myPlayerIndex, _hostAction, _guestAction]
  );

  const resolveSense = useCallback(
    (use: boolean) => {
      if (myPlayerIndex === null) return;
      if (isHost) {
        _hostAction((s) => s.resolveSense(myPlayerIndex, use));
      } else {
        _guestAction({ actionType: "sense", use });
      }
    },
    [isHost, myPlayerIndex, _hostAction, _guestAction]
  );

  const resolveCloud = useCallback(
    (cardId: number) => {
      if (myPlayerIndex === null) return;
      if (isHost) {
        _hostAction((s) => s.resolveCloud(myPlayerIndex, cardId));
      } else {
        _guestAction({ actionType: "cloud", cardId });
      }
    },
    [isHost, myPlayerIndex, _hostAction, _guestAction]
  );

  const forfeit = useCallback(async () => {
    if (myPlayerIndex === null) return;
    if (isHost) {
      // Host path: apply locally, write the match-log record synchronously
      // (before any unmount), then push state so the guest sees game_over.
      const session = sessionRef.current;
      if (!session || !sessionId) return;
      session.forfeit(myPlayerIndex);
      await writeMatchAsHost();
      try {
        const payload = session.getInstantDBPayload();
        await db.transact(
          db.tx.games[sessionId].update({
            ...payload,
            pendingAction: null,
            stateVersion: ((gameRecord?.stateVersion as number) ?? 0) + 1,
          })
        );
      } catch (e) {
        console.error("Forfeit state push failed:", e);
      }
    } else {
      await _guestAction({ actionType: "forfeit" });
    }
  }, [isHost, myPlayerIndex, sessionId, gameRecord, _guestAction]); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = useCallback(() => {
    if (myPlayerIndex === null) return;
    if (isHost) {
      _hostAction((s) => { const ok = s.undo(); return ok ? null : { error: "Can't undo" }; });
    } else {
      _guestAction({ actionType: "undo" });
    }
  }, [isHost, myPlayerIndex, _hostAction, _guestAction]);

  // canUndo comes from the server-computed perspective state — true only when
  // it's the active player's turn AND the session's undo preconditions pass
  // (snapshot stack non-empty, not dirty, phase=actions).
  const canUndo = gameState?.canUndo ?? false;

  // Capture start timestamp on first gameRecord load.
  useEffect(() => {
    if (gameRecord && startedAtRef.current === null) {
      startedAtRef.current = Date.now();
    }
  }, [gameRecord]);

  /** Host-only: write the finished-match record exactly once. Safe to call
   *  from both the natural game-over effect and the forfeit() path. */
  const writeMatchAsHost = useCallback(async () => {
    if (!isHost) return;
    if (matchWrittenRef.current) return;
    const session = sessionRef.current;
    if (!session || !session.game.winner) return;
    if (!gameRecord) return;

    matchWrittenRef.current = true;
    const hostUserId  = String(gameRecord.p0Id ?? "");
    const guestUserId = String(gameRecord.p1Id ?? "");

    let hostProfileId  = "";
    let guestProfileId = "";
    try {
      const result = await db.queryOnce({
        profiles: { $: { where: { odib: { $in: [hostUserId, guestUserId] } } } },
      });
      const profiles = (result.data?.profiles ?? []) as Array<{ id: string; odib: string }>;
      hostProfileId  = profiles.find((p) => p.odib === hostUserId)?.id  ?? "";
      guestProfileId = profiles.find((p) => p.odib === guestUserId)?.id ?? "";
    } catch (e) {
      console.error("Profile lookup failed for match log; continuing without profileIds:", e);
    }

    const identities: [MatchIdentity, MatchIdentity] = [
      { profileId: hostProfileId,  userId: hostUserId,  name: session.players[0].name },
      { profileId: guestProfileId, userId: guestUserId, name: session.players[1].name },
    ];

    await saveMatchRecord({
      session,
      kind: "mp",
      botStrategy: "",
      startedAt: startedAtRef.current ?? Date.now(),
      testDeck: false,
      identities,
    });
  }, [isHost, gameRecord]);

  // Host writes the match-log record once the game phase is game_over.
  useEffect(() => {
    if (gameState?.phase === "game_over") void writeMatchAsHost();
  }, [gameState?.phase, writeMatchAsHost]);

  return {
    gameState,
    loading: loading || gameQuery.isLoading,
    error,
    log,
    flashQueue,
    consumeFlash,
    recap,
    consumeRecap,
    banner,
    consumeBanner,
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
    undo,
    canUndo,
    sessionRef,
  };
}
