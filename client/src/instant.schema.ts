// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from "@instantdb/react";

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $streams: i.entity({
      abortReason: i.string().optional(),
      clientId: i.string().unique().indexed(),
      done: i.boolean().optional(),
      size: i.number().optional(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
      imageURL: i.string().optional(),
      type: i.string().optional(),
    }),
    games: i.entity({
      activePlayer: i.any().optional(),
      engineState: i.any().optional(),
      p0Id: i.any().optional(),
      p0Log: i.any().optional(),
      p0Prompt: i.any().optional(),
      p0State: i.any().optional(),
      p1Id: i.any().optional(),
      p1Log: i.any().optional(),
      p1Prompt: i.any().optional(),
      p1State: i.any().optional(),
      pendingAction: i.any().optional(),
      phase: i.any().optional(),
      roomId: i.any().optional(),
      stateVersion: i.number().optional(),
      turnCount: i.any().optional(),
      updatedAt: i.any().optional(),
      victoryType: i.any().optional(),
      winner: i.any().optional(),
    }),
    rooms: i.entity({
      code: i.string().unique().indexed().optional(),
      createdAt: i.number().optional(),
      firstPlayer: i.string().optional(),
      guestCharacter: i.string().optional(),
      guestId: i.string().optional(),
      guestName: i.string().optional(),
      guestReady: i.boolean().optional(),
      hostCharacter: i.string().optional(),
      hostId: i.string().indexed().optional(),
      hostName: i.string().optional(),
      hostReady: i.boolean().optional(),
      sessionId: i.any().optional(),
      status: i.string().indexed().optional(),
    }),
    profiles: i.entity({
      odib: i.string().unique().indexed().optional(),
      name: i.string().optional(),
      wins: i.number().optional(),
      losses: i.number().optional(),
      draws: i.number().optional(),
      createdAt: i.number().optional(),
    }),
    matches: i.entity({
      kind: i.string().indexed(),
      botStrategy: i.string(),
      createdAt: i.number().indexed(),
      endedAt: i.number(),
      durationMs: i.number(),
      turnCount: i.number(),
      firstPlayerIndex: i.number(),
      winnerIndex: i.number(),
      victoryType: i.string().indexed(),
      forfeiter: i.number(),
      missionNames: i.any(),
      testDeck: i.boolean(),
      // Replay payload — root seed (every RNG stream derives from this) plus
      // the structured action log captured by GameSession. schemaVersion lets
      // future shape changes coexist with older recorded matches.
      seed: i.number().optional(),
      actionLog: i.any().optional(),
      schemaVersion: i.number().optional(),
      // Postgame snapshot — full final state needed to rehydrate the GameOver
      // screen without replaying. missionState carries the MissionData[]
      // (tiers + topReachedBy + playerRanks); activityLog is both players'
      // LogEntry[] streams.
      missionState: i.any().optional(),
      activityLog: i.any().optional(),
    }),
    matchPlayers: i.entity({
      matchId: i.string().indexed(),
      playerIndex: i.number(),
      profileId: i.string().indexed(),
      userId: i.string().indexed(),
      name: i.string(),
      character: i.string().indexed(),
      isBot: i.boolean(),
      damage: i.number(),
      mission: i.number(),
      training: i.number(),
      burns: i.number(),
      atium: i.number(),
      metalTokens: i.any(),
      metalAvailable: i.any(),
      metalBurned: i.any(),
      missionRanks: i.any(),
      finalDeck: i.any(),
      eliminatedCounts: i.any().optional(),
      // Postgame snapshot — full per-player state needed to rehydrate the
      // GameOver screen without replaying. finalHand/Discard/Library/Allies
      // are CardData[] (preserving id, metalUsed, burned, ability slots).
      health: i.number().optional(),
      money: i.number().optional(),
      boxings: i.number().optional(),
      pDamage: i.number().optional(),
      pMoney: i.number().optional(),
      charAbility1: i.boolean().optional(),
      charAbility2: i.boolean().optional(),
      charAbility3: i.boolean().optional(),
      finalHand: i.any().optional(),
      finalDiscard: i.any().optional(),
      finalLibrary: i.any().optional(),
      finalAllies: i.any().optional(),
    }),
    // ── Lands (side-project) multiplayer ──
    // Mirrors `rooms`/`games` shape but kept separate so the two games can
    // evolve independently. Fewer fields — Lands has no characters, missions,
    // or per-player prompts.
    landsRooms: i.entity({
      code: i.string().unique().indexed().optional(),
      createdAt: i.number().optional(),
      firstPlayer: i.string().optional(), // "random" | "host" | "guest"
      guestId: i.string().optional(),
      guestName: i.string().optional(),
      guestReady: i.boolean().optional(),
      hostId: i.string().indexed().optional(),
      hostName: i.string().optional(),
      hostReady: i.boolean().optional(),
      sessionId: i.string().optional(),
      status: i.string().indexed().optional(),
    }),
    landsGames: i.entity({
      roomId: i.string().indexed().optional(),
      p0Id: i.string().indexed().optional(),
      p1Id: i.string().indexed().optional(),
      /** Public state shipped to player 0 (their hand visible; opponent hand redacted). */
      p0State: i.any().optional(),
      /** Public state shipped to player 1 (mirror). */
      p1State: i.any().optional(),
      /** Guest's pending action request, processed by host then cleared. */
      pendingAction: i.any().optional(),
      phase: i.string().indexed().optional(),
      activePlayer: i.number().optional(),
      turnCount: i.number().optional(),
      winner: i.number().optional(),
      winReason: i.string().optional(),
      stateVersion: i.number().optional(),
      updatedAt: i.number().optional(),
    }),
    landsMatches: i.entity({
      kind: i.string().indexed().optional(),
      botKind: i.string().optional(),
      createdAt: i.number().indexed().optional(),
      endedAt: i.number().optional(),
      durationMs: i.number().optional(),
      turnCount: i.number().optional(),
      firstPlayerIndex: i.number().optional(),
      winnerIndex: i.number().optional(),
      winReason: i.string().optional(),
    }),
    landsMatchPlayers: i.entity({
      matchId: i.string().indexed().optional(),
      playerIndex: i.number().optional(),
      profileId: i.string().indexed().optional(),
      userId: i.string().indexed().optional(),
      name: i.string().optional(),
      isBot: i.boolean().optional(),
      finalInPlayByType: i.any().optional(),
      finalHandSize: i.number().optional(),
      finalDeckSize: i.number().optional(),
      finalDiscardSize: i.number().optional(),
    }),
  },
  links: {
    $streams$files: {
      forward: {
        on: "$streams",
        has: "many",
        label: "$files",
      },
      reverse: {
        on: "$files",
        has: "one",
        label: "$stream",
        onDelete: "cascade",
      },
    },
    $usersLinkedPrimaryUser: {
      forward: {
        on: "$users",
        has: "one",
        label: "linkedPrimaryUser",
        onDelete: "cascade",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "linkedGuestUsers",
      },
    },
  },
  rooms: {},
});

// This helps TypeScript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
