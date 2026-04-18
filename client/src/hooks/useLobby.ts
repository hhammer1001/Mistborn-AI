import { useState, useCallback } from "react";
import { db, id } from "../lib/instantdb";

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export type RoomStatus = "waiting" | "character_select" | "in_game" | "finished";
export type FirstPlayerChoice = "random" | "host" | "guest";

export interface Room {
  id: string;
  code: string;
  status: RoomStatus;
  hostId: string;
  hostName: string;
  hostCharacter: string;
  hostReady: boolean;
  guestId: string;
  guestName: string;
  guestCharacter: string;
  guestReady: boolean;
  sessionId?: string;
  createdAt: number;
  firstPlayer?: FirstPlayerChoice;
}

export function useLobby(userId: string | undefined, userName: string | undefined) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to the current room
  const roomQuery = db.useQuery(
    roomId ? { rooms: { $: { where: { id: roomId } } } } : null
  );
  const room = (roomQuery.data?.rooms?.[0] as Room | undefined) ?? null;

  const isHost = room ? room.hostId === userId : false;
  const isGuest = room ? room.guestId === userId : false;
  const myRole = isHost ? "host" : isGuest ? "guest" : null;

  const createRoom = useCallback(async () => {
    if (!userId) return;
    setError(null);
    const newId = id();
    const code = generateRoomCode();
    try {
      await db.transact(
        db.tx.rooms[newId].update({
          code,
          status: "waiting",
          hostId: userId,
          hostName: userName || "Player 1",
          hostCharacter: "Random",
          hostReady: false,
          guestId: "",
          guestName: "",
          guestCharacter: "",
          guestReady: false,
          firstPlayer: "random", // default; host can override in lobby
          createdAt: Date.now(),
        })
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
        // Find room by code
        const result = await db.queryOnce({
          rooms: { $: { where: { code: code.toUpperCase() } } },
        });
        const found = result.data.rooms?.[0] as Room | undefined;
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
        // Join as guest — default to "Random" (resolved at game-start time).
        await db.transact(
          db.tx.rooms[found.id].update({
            guestId: userId,
            guestName: userName || "Player 2",
            guestCharacter: "Random",
            status: "character_select",
          })
        );
        setRoomId(found.id);
      } catch {
        setError("Failed to join room");
      }
    },
    [userId, userName]
  );

  const selectCharacter = useCallback(
    async (character: string) => {
      if (!room || !myRole) return;
      const field = myRole === "host" ? "hostCharacter" : "guestCharacter";
      await db.transact(db.tx.rooms[room.id].update({ [field]: character }));
    },
    [room, myRole]
  );

  const setFirstPlayer = useCallback(
    async (firstPlayer: FirstPlayerChoice) => {
      if (!room || !isHost) return;
      await db.transact(db.tx.rooms[room.id].update({ firstPlayer }));
    },
    [room, isHost]
  );

  const setReady = useCallback(
    async (ready: boolean) => {
      if (!room || !myRole) return;
      const field = myRole === "host" ? "hostReady" : "guestReady";
      await db.transact(db.tx.rooms[room.id].update({ [field]: ready }));
    },
    [room, myRole]
  );

  const leaveRoom = useCallback(async () => {
    if (!room) return;
    if (isHost) {
      // Host leaving deletes the room
      await db.transact(db.tx.rooms[room.id].delete());
    } else if (isGuest) {
      // Guest leaving resets guest fields
      await db.transact(
        db.tx.rooms[room.id].update({
          guestId: "",
          guestName: "",
          guestCharacter: "",
          guestReady: false,
          status: "waiting",
        })
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
    selectCharacter,
    setFirstPlayer,
    setReady,
    leaveRoom,
    setRoomId,
  };
}
