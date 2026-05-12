import { db, id as instantId } from "../../lib/instantdb";
import { LAND_TYPES, type GameState, type LandType, type PlayerState } from "../engine/types";

/** Reserved profile id used for the bot side of any Lands match. */
export const SYSTEM_BOT_PROFILE_ID = "__bot__";

export interface LandsMatchIdentity {
  profileId: string;
  userId: string;
  name: string;
}

export interface SaveLandsMatchArgs {
  /** Final engine state at game_over. */
  state: GameState;
  kind: "lands_mp" | "lands_bot";
  /** Bot variant for SP matches; empty string for MP. */
  botKind: "" | "heuristic" | "flowchart" | "random";
  /** Timestamp (ms) when the match started — used to compute duration. */
  startedAt: number;
  /** Player-0 and player-1 identity. Use SYSTEM_BOT_PROFILE_ID for the bot side. */
  identities: [LandsMatchIdentity, LandsMatchIdentity];
  /** Which seats were bots (defaults to none for MP, seat 1 for bot games). */
  isBot?: [boolean, boolean];
}

function countByType(cards: { type: LandType }[]): Record<LandType, number> {
  const out: Record<LandType, number> = {
    plains: 0,
    island: 0,
    swamp: 0,
    mountain: 0,
    forest: 0,
  };
  for (const c of cards) out[c.type]++;
  return out;
}

function inPlayVector(player: PlayerState): number[] {
  const c = countByType(player.inPlay);
  return LAND_TYPES.map((t) => c[t]);
}

/**
 * Write a single `landsMatches` row + two `landsMatchPlayers` rows. Skips if
 * the state doesn't actually reflect a finished game.
 *
 * Idempotency is the caller's responsibility — the standard pattern is to set
 * a ref/flag in the calling hook so the write fires exactly once on the
 * `phase === "game_over"` transition.
 */
export async function saveLandsMatchRecord(args: SaveLandsMatchArgs): Promise<void> {
  const { state, kind, botKind, startedAt, identities } = args;
  if (state.phase !== "game_over" || state.winner == null) return;

  const matchId = instantId();
  const endedAt = Date.now();
  // The session log's first entry is "X goes first." but we don't carry the
  // index there — derive from `state.activePlayer` at the time the game ended
  // is unreliable too (it flips during effects). Caller could pass it in, but
  // we can recover the original first player from the log: it's whichever
  // player.name appears in "<name> goes first." Match by name; default 0.
  let firstPlayerIndex: 0 | 1 = 0;
  const firstLog = state.log.find((e) => /goes first\.$/.test(e.text));
  if (firstLog) {
    if (firstLog.text.startsWith(state.players[1].name + " ")) firstPlayerIndex = 1;
  }

  const isBot = args.isBot ?? [false, kind === "lands_bot"];
  const playerRowEntries = [0, 1].map((seat) => {
    const p = state.players[seat];
    const ident = identities[seat as 0 | 1];
    return {
      id: instantId(),
      data: {
        matchId,
        playerIndex: seat,
        profileId: ident.profileId,
        userId: ident.userId,
        name: ident.name || p.name,
        isBot: isBot[seat],
        finalInPlayByType: inPlayVector(p),
        finalHandSize: p.hand.length,
        finalDeckSize: p.deck.length,
        finalDiscardSize: p.discard.length,
      },
    };
  });

  try {
    await db.transact([
      db.tx.landsMatches[matchId].update({
        kind,
        botKind,
        createdAt: startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        turnCount: state.turnCount,
        firstPlayerIndex,
        winnerIndex: state.winner,
        winReason: state.winReason ?? "",
      }),
      ...playerRowEntries.map((row) =>
        db.tx.landsMatchPlayers[row.id].update(row.data),
      ),
    ]);
  } catch (e) {
    // Best-effort: don't block UI on match-log failure.
    console.error("Failed to save lands match record:", e);
  }
}
