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

type MatchData = Parameters<(typeof db.tx.matches)[string]["update"]>[0];
type MatchPlayerData = Parameters<(typeof db.tx.matchPlayers)[string]["update"]>[0];

interface PendingMatchSave {
  matchId: string;
  baseMatch: MatchData;
  playerRows: Array<{ id: string; data: MatchPlayerData }>;
  /** Only retry a queued record after its player has authenticated again. */
  ownerUserIds: string[];
}

const PENDING_MATCH_SAVES_KEY = "mistborn.pending-match-saves.v1";
const SAVE_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [500, 1_500];

function readPendingMatchSaves(): PendingMatchSave[] {
  try {
    const raw = window.localStorage.getItem(PENDING_MATCH_SAVES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed as PendingMatchSave[] : [];
  } catch {
    // Storage can be disabled or contain an old/corrupt value. A live save can
    // still proceed; it simply will not have an offline fallback.
    return [];
  }
}

function writePendingMatchSaves(saves: PendingMatchSave[]): void {
  try {
    window.localStorage.setItem(PENDING_MATCH_SAVES_KEY, JSON.stringify(saves));
  } catch (e) {
    console.error("Failed to queue match record for retry:", e);
  }
}

function queuePendingMatchSave(save: PendingMatchSave): void {
  const saves = readPendingMatchSaves();
  if (!saves.some((pending) => pending.matchId === save.matchId)) saves.push(save);
  writePendingMatchSaves(saves);
}

function removePendingMatchSave(matchId: string): void {
  writePendingMatchSaves(readPendingMatchSaves().filter((save) => save.matchId !== matchId));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function verifyMatchSave(matchId: string): Promise<boolean> {
  const result = await db.queryOnce({
    matches: { $: { where: { id: matchId } } },
  });
  return (result.data?.matches ?? []).some((match) => match.id === matchId);
}

/**
 * Writes a stable match bundle, then reads it back. Retrying an identical
 * bundle is safe: InstantDB updates the same match and player ids rather than
 * creating duplicate records.
 */
async function persistPendingMatchSave(save: PendingMatchSave): Promise<boolean> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
    try {
      await db.transact([
        db.tx.matches[save.matchId].update(save.baseMatch),
        ...save.playerRows.map((row) => db.tx.matchPlayers[row.id].update(row.data)),
      ]);
      if (await verifyMatchSave(save.matchId)) {
        removePendingMatchSave(save.matchId);
        return true;
      }
      lastError = new Error("Match record was not visible after a successful write");
    } catch (e) {
      lastError = e;
    }

    if (attempt < SAVE_ATTEMPTS - 1) await delay(RETRY_DELAYS_MS[attempt]);
  }

  console.error("Failed to save match record; queued for a later retry:", lastError);
  return false;
}

/** Retry saved match records on the next launch or when connectivity returns. */
export async function retryPendingMatchSaves(userId: string): Promise<void> {
  const saves = readPendingMatchSaves().filter((save) => save.ownerUserIds.includes(userId));
  for (const save of saves) await persistPendingMatchSave(save);
}

function countByName(cards: Array<{ name: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cards) {
    out[c.name] = (out[c.name] ?? 0) + 1;
  }
  return out;
}

function countNames(names: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of names) out[n] = (out[n] ?? 0) + 1;
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

/** Serialize an array of engine card/ally objects to plain CardData JSON.
 *  Uses each card's own toJSON so per-card state (metalUsed, burned, ability
 *  slots, ally health/availability) is preserved for the postgame screen. */
function serializeCards(cards: Array<{ toJSON: () => unknown }>): unknown[] {
  return cards.map((c) => c.toJSON());
}

export async function saveMatchRecord(args: SaveMatchArgs): Promise<boolean> {
  const { session, kind, botStrategy, startedAt, testDeck, identities, forfeiterHint } = args;
  const firstPlayerIndex = session.firstPlayer;
  const game = session.game;
  const winner = game.winner;
  if (!winner) {
    // Without a resolved winner we have nothing meaningful to persist.
    return false;
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

  const [p0Log, p1Log] = session.getActivityLogs();
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
    seed: game.seed,
    actionLog: session.getActionLog(),
    schemaVersion: 2,
    // Postgame snapshot — full final state needed by the GameOver screen.
    missionState: missions.map((m) => m.toJSON()),
    activityLog: { p0: p0Log, p1: p1Log },
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
        eliminatedCounts: countNames(p.eliminatedCardNames),

        // Postgame snapshot — full per-player state needed to rehydrate the
        // GameOver screen without replaying. finalHand/Discard/Library/Allies
        // are CardData[] (preserving id, metalUsed, burned, ability slots).
        health: p.curHealth,
        money: p.curMoney,
        boxings: p.curBoxings,
        pDamage: p.pDamage,
        pMoney: p.pMoney,
        charAbility1: p.charAbility1,
        charAbility2: p.charAbility2,
        charAbility3: p.charAbility3,
        finalHand: serializeCards(p.deck.hand),
        finalDiscard: serializeCards(p.deck.discard),
        finalLibrary: serializeCards(p.deck.cards),
        finalAllies: serializeCards(p.allies),
      },
    };
  });

  const pending: PendingMatchSave = {
    matchId,
    baseMatch,
    playerRows,
    ownerUserIds: identities.map((identity) => identity.userId).filter(Boolean),
  };

  // Queue before the first network call so an offline close/reload cannot lose
  // a completed game. The queue is removed only after read-back verification.
  queuePendingMatchSave(pending);
  return persistPendingMatchSave(pending);
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
