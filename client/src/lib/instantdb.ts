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
      // First-player choice: "random" | "host" | "guest". Random decided at start time.
      firstPlayer: i.string(),
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
    // ── Finished-match log ─────────────────────────────────────────
    // Written after each game ends (natural end or forfeit). Enables
    // history/stat queries without re-reading the running `games` row.
    matches: i.entity({
      kind: i.string().indexed(),          // "mp" | "bot"
      botStrategy: i.string(),             // "squash" | "twonky" | ... | "" for mp
      createdAt: i.number().indexed(),     // match start timestamp
      endedAt: i.number(),
      durationMs: i.number(),
      turnCount: i.number(),
      firstPlayerIndex: i.number(),        // 0 | 1
      winnerIndex: i.number(),             // 0 | 1 (forfeits: non-forfeiter)
      victoryType: i.string().indexed(),   // "M" | "D" | "C" | "F"
      forfeiter: i.number(),               // 0 | 1 | -1 (-1 = natural end)
      missionNames: i.any(),               // string[]
      testDeck: i.boolean(),
    }),
    // One row per player per match. Keeps user-scoped queries cheap
    // and opens the door to per-character / per-card stats.
    matchPlayers: i.entity({
      matchId: i.string().indexed(),
      playerIndex: i.number(),             // 0 | 1
      profileId: i.string().indexed(),     // "__bot__" sentinel for bot side, "" for guest
      userId: i.string().indexed(),        // "" for bot or unauthed guest
      name: i.string(),
      character: i.string().indexed(),
      isBot: i.boolean(),

      // Final numeric state
      damage: i.number(),
      mission: i.number(),
      training: i.number(),
      burns: i.number(),
      atium: i.number(),

      // Per-metal counts (9 slots, in engine METAL_NAMES order)
      metalTokens: i.any(),
      metalAvailable: i.any(),
      metalBurned: i.any(),

      // Per-mission progress, aligned with matches.missionNames
      missionRanks: i.any(),               // number[]

      // Final deck composition as name->count (allies folded in).
      // Enables queries like "matches where Yeden was in the deck".
      finalDeck: i.any(),                  // Record<string, number>
    }),
  },
});

export const db = init({ appId: APP_ID, schema });
export { id };
export type Schema = typeof schema;
