import { init, i, id } from "@instantdb/react";

const APP_ID = import.meta.env.VITE_INSTANTDB_APP_ID as string;

const schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    profiles: i.entity({
      name: i.string(),
      odib: i.string().indexed(), // owner's $user id, for querying
      wins: i.number(),
      losses: i.number(),
      draws: i.number(),
      createdAt: i.number(),
    }),
    rooms: i.entity({
      code: i.string().unique().indexed(),
      status: i.string().indexed(), // "waiting" | "character_select" | "in_game" | "finished"
      hostId: i.string().indexed(),
      hostName: i.string(),
      hostCharacter: i.string(),
      hostReady: i.boolean(),
      guestId: i.string(),
      guestName: i.string(),
      guestCharacter: i.string(),
      guestReady: i.boolean(),
      sessionId: i.string(), // game ID when status is "in_game"
      createdAt: i.number(),
    }),
    games: i.entity({
      roomId: i.string().indexed(),
      phase: i.string().indexed(), // "actions" | "damage" | "sense_defense" | "cloud_defense" | "awaiting_prompt" | "game_over"
      activePlayer: i.number(), // 0 or 1
      turnCount: i.number(),
      p0State: i.any(), // JSON game state for player 0
      p1State: i.any(), // JSON game state for player 1
      p0Prompt: i.any(), // prompt data for player 0 (null if none)
      p1Prompt: i.any(), // prompt data for player 1 (null if none)
      winner: i.string(),
      victoryType: i.string(),
      p0Id: i.string().indexed(),
      p1Id: i.string().indexed(),
      updatedAt: i.number(),
      stateVersion: i.number(), // optimistic lock counter
      // Guest action queue: guest writes here, host processes and clears
      pendingAction: i.any(), // { type, playerId, ...params } or null
    }),
  },
});

export const db = init({ appId: APP_ID, schema });
export { id };
export type Schema = typeof schema;
