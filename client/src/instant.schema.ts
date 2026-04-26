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
