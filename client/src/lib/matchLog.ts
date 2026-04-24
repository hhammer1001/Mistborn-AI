import { db, id as instantId } from "./instantdb";
import type { GameSession } from "../engine/session";
import type { Player } from "../engine/player";

/** Reserved profile id used for the bot side of any match. */
export const SYSTEM_BOT_PROFILE_ID = "__bot__";

export interface MatchIdentity {
  profileId: string;
  userId: string;
  name: string;
}

export interface SaveMatchArgs {
  session: GameSession;
  kind: "mp" | "bot";
  botStrategy: string;                 // "" for mp
  startedAt: number;
  testDeck: boolean;
  /** Player-0 and player-1 identity; use SYSTEM_BOT_PROFILE_ID for the bot side. */
  identities: [MatchIdentity, MatchIdentity];
  /** Optional explicit forfeiter index for tab-close writes; inferred from session otherwise. */
  forfeiterHint?: 0 | 1;
}

function countByName(cards: Array<{ name: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cards) {
    out[c.name] = (out[c.name] ?? 0) + 1;
  }
  return out;
}

function playerCards(player: Player): Array<{ name: string }> {
  // Fold library + hand + discard + allies into one list of {name}.
  const deck = player.deck;
  return [
    ...deck.cards,
    ...deck.hand,
    ...deck.discard,
    ...player.allies,
  ];
}

export async function saveMatchRecord(args: SaveMatchArgs): Promise<void> {
  const { session, kind, botStrategy, startedAt, testDeck, identities, forfeiterHint } = args;
  const firstPlayerIndex = session.firstPlayer;
  const game = session.game;
  const winner = game.winner;
  if (!winner) {
    // Without a resolved winner we have nothing meaningful to persist.
    return;
  }
  const winnerIndex = winner.turnOrder as 0 | 1;
  const victoryType = game.victoryType || "M";
  const forfeiter: number =
    victoryType === "F"
      ? (forfeiterHint ?? ((1 - winnerIndex) as 0 | 1))
      : -1;

  const endedAt = Date.now();
  const matchId = instantId();

  const missions = game.missions;
  const missionNames = missions.map((m) => m.name);

  const baseMatch = {
    kind,
    botStrategy,
    createdAt: startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
    turnCount: game.turncount,
    firstPlayerIndex,
    winnerIndex,
    victoryType,
    forfeiter,
    missionNames,
    testDeck,
  };

  const playerRows = [0, 1].map((idx) => {
    const p = game.players[idx];
    const ident = identities[idx];
    return {
      id: instantId(),
      data: {
        matchId,
        playerIndex: idx,
        profileId: ident.profileId,
        userId: ident.userId,
        name: ident.name || p.name,
        character: p.character,
        isBot: ident.profileId === SYSTEM_BOT_PROFILE_ID,

        damage: p.curDamage,
        mission: p.curMission,
        training: p.training,
        burns: p.burns,
        atium: p.atium,

        metalTokens: [...p.metalTokens],
        metalAvailable: [...p.metalAvailable],
        metalBurned: [...p.metalBurned],

        missionRanks: missions.map((m) => m.playerRanks[idx]),
        finalDeck: countByName(playerCards(p)),
      },
    };
  });

  try {
    await db.transact([
      db.tx.matches[matchId].update(baseMatch),
      ...playerRows.map((row) => db.tx.matchPlayers[row.id].update(row.data)),
    ]);
  } catch (e) {
    // Best-effort: log but don't throw — we never want to block the UI
    // transition (e.g. game-over screen) because of a write failure.
    console.error("Failed to save match record:", e);
  }
}

/** Convenience: derive the bot-side identity from its strategy.
 *  Character is carried on the matchPlayer row via session.players[i].character. */
export function botIdentity(strategy: string): MatchIdentity {
  const pretty = strategy.charAt(0).toUpperCase() + strategy.slice(1);
  return {
    profileId: SYSTEM_BOT_PROFILE_ID,
    userId: "",
    name: `${pretty} Bot`,
  };
}
