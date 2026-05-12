import { useCallback, useState } from "react";
import { db, id } from "../../lib/instantdb";

function generateRoomCode(): string {
  // Same alphabet as the Mistborn lobby — omits letters that look like digits
  // so users can transcribe codes over voice without ambiguity.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export type LandsRoomStatus = "waiting" | "ready_check" | "in_game" | "finished";
export type LandsFirstPlayerChoice = "random" | "host" | "guest";

/** Shape of a row in the `landsRooms` table. No character/mission fields —
 *  Lands has no character pick. */
export interface LandsRoom {
  id: string;
  code: string;
  status: LandsRoomStatus;
  hostId: string;
  hostName: string;
  hostReady: boolean;
  guestId: string;
  guestName: string;
  guestReady: boolean;
  sessionId?: string;
  createdAt: number;
  firstPlayer?: LandsFirstPlayerChoice;
}

export function useLandsLobby(
  userId: string | undefined,
  userName: string | undefined,
) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roomQuery = db.useQuery(
    roomId ? { landsRooms: { $: { where: { id: roomId } } } } : null,
  );
  const room =
    (roomQuery.data?.landsRooms?.[0] as LandsRoom | undefined) ?? null;

  const isHost = room ? room.hostId === userId : false;
  const isGuest = room ? room.guestId === userId : false;
  const myRole: "host" | "guest" | null = isHost
    ? "host"
    : isGuest
      ? "guest"
      : null;

  const createRoom = useCallback(async () => {
    if (!userId) return;
    setError(null);
    const newId = id();
    const code = generateRoomCode();
    try {
      await db.transact(
        db.tx.landsRooms[newId].update({
          code,
          status: "waiting",
          hostId: userId,
          hostName: userName || "Player 1",
          hostReady: false,
          guestId: "",
          guestName: "",
          guestReady: false,
          firstPlayer: "random",
          createdAt: Date.now(),
        }),
      );
      setRoomId(newId);
    } catch {
      setError("Failed to create room");
    }
  }, [userId, userName]);

  const joinRoom = useCallback(
    async (code: string) => {
      if (!userId) return;
      setError(null);
      try {
        const result = await db.queryOnce({
          landsRooms: { $: { where: { code: code.toUpperCase() } } },
        });
        const found = result.data.landsRooms?.[0] as LandsRoom | undefined;
        if (!found) {
          setError("Room not found");
          return;
        }
        if (found.status !== "waiting") {
          setError("Room is no longer accepting players");
          return;
        }
        if (found.hostId === userId) {
          setError("You can't join your own room");
          return;
        }
        await db.transact(
          db.tx.landsRooms[found.id].update({
            guestId: userId,
            guestName: userName || "Player 2",
            status: "ready_check",
          }),
        );
        setRoomId(found.id);
      } catch {
        setError("Failed to join room");
      }
    },
    [userId, userName],
  );

  const setFirstPlayer = useCallback(
    async (firstPlayer: LandsFirstPlayerChoice) => {
      if (!room || !isHost) return;
      await db.transact(db.tx.landsRooms[room.id].update({ firstPlayer }));
    },
    [room, isHost],
  );

  const setReady = useCallback(
    async (ready: boolean) => {
      if (!room || !myRole) return;
      const field = myRole === "host" ? "hostReady" : "guestReady";
      await db.transact(db.tx.landsRooms[room.id].update({ [field]: ready }));
    },
    [room, myRole],
  );

  const leaveRoom = useCallback(async () => {
    if (!room) return;
    if (isHost) {
      await db.transact(db.tx.landsRooms[room.id].delete());
    } else if (isGuest) {
      await db.transact(
        db.tx.landsRooms[room.id].update({
          guestId: "",
          guestName: "",
          guestReady: false,
          status: "waiting",
        }),
      );
    }
    setRoomId(null);
  }, [room, isHost, isGuest]);

  return {
    room,
    roomId,
    myRole,
    isHost,
    isGuest,
    error,
    isLoading: roomQuery.isLoading,
    createRoom,
    joinRoom,
    setFirstPlayer,
    setReady,
    leaveRoom,
    setRoomId,
  };
}
