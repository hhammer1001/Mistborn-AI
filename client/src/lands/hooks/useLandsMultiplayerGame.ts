import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../lib/instantdb";
import { LandsSession } from "../engine/session";
import type { GameState } from "../engine/types";
import { saveLandsMatchRecord, type LandsMatchIdentity } from "../lib/landsMatchLog";

/**
 * Multiplayer game hook for Lands. Mirrors Mistborn's `useMultiplayerGame`
 * architecture:
 *
 *   - The HOST holds a `LandsSession` in memory and processes every action
 *     (host's own + guest's). After each state change the host writes a
 *     perspective-filtered payload to InstantDB.
 *   - The GUEST writes action requests to `landsGames[id].pendingAction`.
 *     A host-side effect picks them up, runs them through the session, and
 *     clears the pending field.
 *   - Both clients read state from InstantDB subscriptions.
 *
 * The session is held in `sessionRef`. App.tsx is responsible for creating
 * it when the room transitions to `in_game`.
 */

interface PendingAction {
  type:
    | "playCard"
    | "passMain"
    | "counter"
    | "declineCounter"
    | "resolveMountain"
    | "resolveSwamp"
    | "resolveForest"
    | "resolveIsland";
  playerIndex: 0 | 1;
  /** Parameters keyed by action type — narrowed at process time. */
  cardId?: number;
  islandId?: number;
  matchId?: number;
  targetId?: number;
  discardIds?: number[];
  topOrderIds?: number[];
}

interface LandsGameRow {
  id: string;
  p0Id?: string;
  p1Id?: string;
  p0State?: GameState;
  p1State?: GameState;
  pendingAction?: PendingAction | null;
  phase?: string;
  activePlayer?: number;
  turnCount?: number;
  winner?: number | null;
  winReason?: string | null;
  stateVersion?: number;
  updatedAt?: number;
}

export interface UseLandsMultiplayerGameApi {
  state: GameState | null;
  myPlayerIndex: 0 | 1 | null;
  isHost: boolean;
  isMyTurn: boolean;
  loading: boolean;
  error: string | null;
  playCard: (cardId: number) => void;
  passMain: () => void;
  counter: (islandId: number, matchId: number) => void;
  declineCounter: () => void;
  resolveMountain: (targetId: number) => void;
  resolveSwamp: (targetId: number) => void;
  resolveForest: (cardId: number) => void;
  resolveIsland: (discardIds: number[], keepOrderIds: number[]) => void;
}

export function useLandsMultiplayerGame(
  sessionId: string | null,
  userId: string | null,
): UseLandsMultiplayerGameApi & {
  /** Host owns this ref. App.tsx writes the freshly-constructed `LandsSession`
   *  into it when starting a match; the hook then drives it. */
  sessionRef: React.MutableRefObject<LandsSession | null>;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<LandsSession | null>(null);
  /** Host's local view of the engine state. Bypasses the DB roundtrip so the
   *  host gets instant visual feedback when they click — otherwise the Board
   *  would stay frozen until the InstantDB transaction completes ~200ms later
   *  and subsequent clicks would silently no-op (session sees the new phase,
   *  rejects the action). Guest still derives state from the DB. */
  const [hostSnap, setHostSnap] = useState<GameState | null>(null);
  /** Host-only: ensures the finished-match write fires exactly once even if
   *  the game_over state propagates through multiple emits. */
  const matchWrittenRef = useRef(false);
  /** Match start timestamp, set when the host pins its session in. */
  const startedAtRef = useRef<number | null>(null);
  useEffect(() => {
    matchWrittenRef.current = false;
    startedAtRef.current = sessionId ? Date.now() : null;
    if (!sessionId) setHostSnap(null);
  }, [sessionId]);

  const gameQuery = db.useQuery(
    sessionId ? { landsGames: { $: { where: { id: sessionId } } } } : null,
  );
  const gameRow =
    (gameQuery.data?.landsGames?.[0] as LandsGameRow | undefined) ?? null;

  const myPlayerIndex = useMemo<0 | 1 | null>(() => {
    if (!gameRow || !userId) return null;
    if (gameRow.p0Id === userId) return 0;
    if (gameRow.p1Id === userId) return 1;
    return null;
  }, [gameRow, userId]);

  const isHost = myPlayerIndex === 0;

  const state = useMemo<GameState | null>(() => {
    if (myPlayerIndex === null) return null;
    if (myPlayerIndex === 0) {
      // Host prefers the in-memory session snapshot (instant feedback). Falls
      // back to the DB row when the snapshot hasn't been wired up yet
      // (between sessionId being set and the subscribe useEffect firing).
      if (hostSnap) return hostSnap;
      return (gameRow?.p0State as GameState | undefined) ?? null;
    }
    if (!gameRow) return null;
    return (gameRow.p1State as GameState | undefined) ?? null;
  }, [gameRow, myPlayerIndex, hostSnap]);

  const isMyTurn = state ? state.activePlayer === myPlayerIndex : false;

  // Bump version + write a fresh redacted payload for both players. Host only.
  const writeHostPayload = useCallback(
    async (clearPending: boolean) => {
      if (!sessionRef.current || !sessionId || !isHost) return;
      const version = ((gameRow?.stateVersion ?? 0) as number) + 1;
      const payload = sessionRef.current.getDbPayload(version);
      try {
        await db.transact(
          db.tx.landsGames[sessionId].update({
            ...payload,
            ...(clearPending ? { pendingAction: null } : {}),
          }),
        );
      } catch (e) {
        setError(String(e));
      }
    },
    [sessionId, isHost, gameRow?.stateVersion],
  );

  // ── Host: process pending guest actions ──
  useEffect(() => {
    if (!isHost || !sessionId || !gameRow) return;
    const pending = gameRow.pendingAction;
    if (!pending) return;
    const session = sessionRef.current;
    if (!session) return;

    try {
      switch (pending.type) {
        case "playCard":
          if (pending.cardId != null) session.playCard(pending.cardId);
          break;
        case "passMain":
          session.passMain();
          break;
        case "counter":
          if (pending.islandId != null && pending.matchId != null) {
            session.counter(pending.islandId, pending.matchId);
          }
          break;
        case "declineCounter":
          session.declineCounter();
          break;
        case "resolveMountain":
          if (pending.targetId != null) session.resolveMountain(pending.targetId);
          break;
        case "resolveSwamp":
          if (pending.targetId != null) session.resolveSwamp(pending.targetId);
          break;
        case "resolveForest":
          if (pending.cardId != null) session.resolveForest(pending.cardId);
          break;
        case "resolveIsland":
          if (pending.discardIds && pending.topOrderIds) {
            session.resolveIsland(pending.discardIds, pending.topOrderIds);
          }
          break;
      }
    } catch (e) {
      console.error("Error processing guest action:", e);
    }

    // Always write + clear pending, even if the action errored — keeps the
    // guest from getting stuck waiting on a stale pending field.
    void writeHostPayload(true);
  }, [isHost, sessionId, gameRow, writeHostPayload]);

  // ── Host: write the finished-match log row exactly once ──
  useEffect(() => {
    if (!isHost) return;
    if (state?.phase !== "game_over") return;
    if (matchWrittenRef.current) return;
    if (!gameRow) return;
    matchWrittenRef.current = true;

    const p0UserId = String(gameRow.p0Id ?? "");
    const p1UserId = String(gameRow.p1Id ?? "");
    (async () => {
      let p0ProfileId = "";
      let p1ProfileId = "";
      try {
        const result = await db.queryOnce({
          profiles: {
            $: { where: { odib: { $in: [p0UserId, p1UserId] } } },
          },
        });
        const profiles = (result.data?.profiles ?? []) as Array<{
          id: string;
          odib: string;
        }>;
        p0ProfileId = profiles.find((p) => p.odib === p0UserId)?.id ?? "";
        p1ProfileId = profiles.find((p) => p.odib === p1UserId)?.id ?? "";
      } catch (e) {
        console.error("Lands profile lookup failed; continuing:", e);
      }
      const identities: [LandsMatchIdentity, LandsMatchIdentity] = [
        { profileId: p0ProfileId, userId: p0UserId, name: state.players[0].name },
        { profileId: p1ProfileId, userId: p1UserId, name: state.players[1].name },
      ];
      try {
        await saveLandsMatchRecord({
          state,
          kind: "lands_mp",
          botKind: "",
          startedAt: startedAtRef.current ?? Date.now(),
          identities,
          isBot: [false, false],
        });
      } catch (e) {
        console.error("saveLandsMatchRecord failed:", e);
      }
    })();
  }, [isHost, state, gameRow]);

  // ── Host: subscribe to local session — drives both UI state and DB sync ──
  // Every emit updates `hostSnap` so the host's Board re-renders immediately.
  // DB writes are skipped on the very first emit (App.tsx already wrote the
  // initial payload at match-start) but fire on every subsequent emit so the
  // guest stays in sync.
  useEffect(() => {
    if (!isHost || !sessionId) return;
    const session = sessionRef.current;
    if (!session) return;
    let firstEmit = true;
    const unsub = session.subscribe(() => {
      setHostSnap(session.snapshotFor(0));
      if (firstEmit) {
        firstEmit = false;
        return;
      }
      void writeHostPayload(false);
    });
    return unsub;
  }, [isHost, sessionId, writeHostPayload]);

  // ── Action plumbing ──

  /** Run an action through the host's session; or write a request as guest. */
  const submit = useCallback(
    async (
      host: (s: LandsSession) => void,
      guestAction: Omit<PendingAction, "playerIndex">,
    ) => {
      if (myPlayerIndex === null) return;
      setError(null);
      if (isHost) {
        const session = sessionRef.current;
        if (!session) return;
        setLoading(true);
        try {
          host(session);
        } catch (e) {
          setError(String(e));
        } finally {
          setLoading(false);
        }
      } else {
        if (!sessionId) return;
        setLoading(true);
        try {
          await db.transact(
            db.tx.landsGames[sessionId].update({
              pendingAction: { ...guestAction, playerIndex: myPlayerIndex },
            }),
          );
        } catch (e) {
          setError(String(e));
        } finally {
          setLoading(false);
        }
      }
    },
    [isHost, myPlayerIndex, sessionId],
  );

  const playCard = useCallback(
    (cardId: number) =>
      submit(
        (s) => s.playCard(cardId),
        { type: "playCard", cardId },
      ),
    [submit],
  );

  const passMain = useCallback(
    () => submit((s) => s.passMain(), { type: "passMain" }),
    [submit],
  );

  const counter = useCallback(
    (islandId: number, matchId: number) =>
      submit(
        (s) => s.counter(islandId, matchId),
        { type: "counter", islandId, matchId },
      ),
    [submit],
  );

  const declineCounter = useCallback(
    () => submit((s) => s.declineCounter(), { type: "declineCounter" }),
    [submit],
  );

  const resolveMountain = useCallback(
    (targetId: number) =>
      submit(
        (s) => s.resolveMountain(targetId),
        { type: "resolveMountain", targetId },
      ),
    [submit],
  );

  const resolveSwamp = useCallback(
    (targetId: number) =>
      submit(
        (s) => s.resolveSwamp(targetId),
        { type: "resolveSwamp", targetId },
      ),
    [submit],
  );

  const resolveForest = useCallback(
    (cardId: number) =>
      submit(
        (s) => s.resolveForest(cardId),
        { type: "resolveForest", cardId },
      ),
    [submit],
  );

  const resolveIsland = useCallback(
    (discardIds: number[], topOrderIds: number[]) =>
      submit(
        (s) => s.resolveIsland(discardIds, topOrderIds),
        { type: "resolveIsland", discardIds, topOrderIds },
      ),
    [submit],
  );

  return {
    state,
    myPlayerIndex,
    isHost,
    isMyTurn,
    loading,
    error,
    playCard,
    passMain,
    counter,
    declineCounter,
    resolveMountain,
    resolveSwamp,
    resolveForest,
    resolveIsland,
    sessionRef,
  };
}
