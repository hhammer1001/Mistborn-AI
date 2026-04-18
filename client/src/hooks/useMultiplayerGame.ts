import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { db } from "../lib/instantdb";
import type { GameState, GameAction, BotLogEntry, PlayerData } from "../types/game";
import type { LogEntry, TurnRecap } from "./useGame";
import { GameSession } from "../engine/session";

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

  // ── Flash queue & recap: detect new opponent log entries + turn transitions ──
  const [flashQueue, setFlashQueue] = useState<BotLogEntry[]>([]);
  const [recap, setRecap] = useState<TurnRecap | null>(null);
  const seenBotLogLenRef = useRef(0);
  const turnStartBotLogLenRef = useRef(0);
  const prevSnapshotRef = useRef<{ turn: number; isMyTurn: boolean; you: PlayerData; opp: PlayerData; missions: GameState["missions"] } | null>(null);

  const BUY_ACTION_TYPES = useMemo(() => new Set(["buy", "buy_eliminate", "buy_with_boxings", "buy_elim_boxings"]), []);

  const consumeFlash = useCallback(() => setFlashQueue((q) => q.slice(1)), []);
  const consumeRecap = useCallback(() => setRecap(null), []);

  useEffect(() => {
    if (!gameState) { seenBotLogLenRef.current = 0; prevSnapshotRef.current = null; return; }
    const botLog = (gameState.botLog ?? []) as BotLogEntry[];
    const seen = seenBotLogLenRef.current;
    if (botLog.length > seen) {
      const newEntries = botLog.slice(seen).filter((e) => e.card && e.actionType !== "refresh_metal" && e.actionType !== "burn_card");
      if (newEntries.length) setFlashQueue((q) => [...q, ...newEntries]);
      seenBotLogLenRef.current = botLog.length;
    }

    const prev = prevSnapshotRef.current;
    const me = myPlayerIndex ?? 0;
    const opp = 1 - me;

    // Detect "opponent's turn just ended" by transition: prev.isMyTurn=false → current isMyTurn=true.
    // prev captures state at start of opponent's turn (snapshotted when turn handed off).
    if (prev && isMyTurn && !prev.isMyTurn) {
      const newYou = gameState.players[me];
      const newOpp = gameState.players[opp];
      const r: TurnRecap = {};
      const trained = newOpp.training - prev.opp.training;
      const healed = Math.max(0, newOpp.health - prev.opp.health);
      const playerHpLoss = Math.max(0, prev.you.health - newYou.health);
      if (playerHpLoss > 0) r.damageToPlayer = { name: prev.you.name, amount: playerHpLoss };

      // Cards bought during opponent's turn: entries added to botLog since turn start.
      const turnEntries = botLog.slice(turnStartBotLogLenRef.current);
      const bought = turnEntries
        .filter((e) => e.actionType && BUY_ACTION_TYPES.has(e.actionType) && e.card)
        .map((e) => e.card!.name);
      if (bought.length) r.boughtCards = bought;

      const allyDamage: { name: string; amount: number }[] = [];
      const newAllyById = new Map((newYou.allies ?? []).map((a) => [a.id, a]));
      for (const oldAlly of prev.you.allies ?? []) {
        const newAlly = newAllyById.get(oldAlly.id);
        const oldHp = oldAlly.health ?? 0;
        const newHp = newAlly?.health ?? 0;
        const killed = !newAlly;
        const dmg = killed ? oldHp : Math.max(0, oldHp - newHp);
        if (dmg > 0) allyDamage.push({ name: oldAlly.name, amount: dmg });
      }
      if (allyDamage.length) r.damageToAllies = allyDamage;

      let missionDelta = 0;
      for (let i = 0; i < gameState.missions.length; i++) {
        const oldRank = prev.missions[i]?.playerRanks?.[opp] ?? 0;
        const newRank = gameState.missions[i]?.playerRanks?.[opp] ?? 0;
        if (newRank > oldRank) missionDelta += newRank - oldRank;
      }
      if (trained > 0) r.trained = trained;
      if (missionDelta > 0) r.mission = missionDelta;
      if (healed > 0) r.healed = healed;
      if (Object.keys(r).length > 0) setRecap(r);
    }

    // Only refresh the snapshot on turn-boundary transitions, not every state update.
    // This preserves the "at start of opponent's turn" snapshot needed for the recap.
    const isBoundary = !prev || prev.isMyTurn !== isMyTurn;
    if (isBoundary) {
      prevSnapshotRef.current = {
        turn: gameState.turnCount,
        isMyTurn,
        you: gameState.players[me],
        opp: gameState.players[opp],
        missions: gameState.missions,
      };
      turnStartBotLogLenRef.current = botLog.length;
    }
  }, [gameState, isMyTurn, myPlayerIndex]);

  // Build log
  const log = useMemo<LogEntry[]>(() => {
    if (!gameState) return [];
    const entries: LogEntry[] = [];
    for (const entry of gameState.playerLog ?? []) {
      entries.push({ turn: entry.turn, text: entry.text, isBot: false });
    }
    for (const entry of gameState.botLog ?? []) {
      entries.push({ turn: entry.turn, text: entry.text, isBot: true });
    }
    entries.sort((a, b) => a.turn - b.turn);
    return entries;
  }, [gameState]);

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
        // Advance repeatedly
        let state = session.getState(myPlayerIndex);
        let actions = state.availableActions as GameAction[];
        while (true) {
          const action = actions?.find((a: any) => a.code === 1 && a.missionName === missionName);
          if (!action) break;
          const result = session.playAction(myPlayerIndex, action.index);
          if (result?.error) break;
          state = session.getState(myPlayerIndex);
          actions = state.availableActions as GameAction[];
          if (state.phase === "game_over") break;
        }
        const payload = session.getInstantDBPayload();
        await db.transact(
          db.tx.games[sessionId].update({
            ...payload,
            pendingAction: null,
            stateVersion: ((gameRecord?.stateVersion as number) ?? 0) + 1,
          })
        );
      } else {
        // Guest: advance one at a time via pending actions
        // (the host will process each one)
        if (!gameState) return;
        const action = gameState.availableActions.find(
          (a) => a.code === 1 && a.missionName === missionName
        );
        if (action) {
          await _guestAction({ actionType: "action", actionIndex: action.index });
        }
      }
    },
    [isHost, myPlayerIndex, sessionId, gameRecord, gameState, _guestAction]
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

  const forfeit = useCallback(() => {
    if (myPlayerIndex === null) return;
    if (isHost) {
      _hostAction((s) => { s.forfeit(myPlayerIndex); return null; });
    } else {
      _guestAction({ actionType: "forfeit" });
    }
  }, [isHost, myPlayerIndex, _hostAction, _guestAction]);

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

  return {
    gameState,
    loading: loading || gameQuery.isLoading,
    error,
    log,
    flashQueue,
    consumeFlash,
    recap,
    consumeRecap,
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
