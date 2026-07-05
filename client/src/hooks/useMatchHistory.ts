import { useMemo } from "react";
import { db } from "../lib/instantdb";
import type { ChronicleEntry } from "../components/MinistrySidebar";
import type { BotType, VictoryType } from "../data/ministrySigils";
import { startingHealthForSeat } from "../engine/player";

interface MatchRow {
  id: string;
  kind?: "mp" | "bot";
  botStrategy?: string;
  createdAt?: number;
  endedAt?: number;
  durationMs?: number;
  turnCount?: number;
  firstPlayerIndex?: 0 | 1;
  winnerIndex?: 0 | 1;
  victoryType?: string;
  forfeiter?: number;
  missionNames?: string[];
  testDeck?: boolean;
}

interface PlayerRow {
  id: string;
  matchId: string;
  playerIndex: 0 | 1;
  profileId: string;
  userId: string;
  name: string;
  character: string;
  isBot: boolean;
  damage: number;
  mission: number;
  training?: number;
  burns?: number;
  atium?: number;
  /** Final HP snapshot (schemaVersion ≥ 2). */
  health?: number;
  /** Final rank on each of the match's 3 missions (seat's own ranks). */
  missionRanks?: number[];
  finalDeck?: Record<string, number>;
}

const VICTORY_LETTER_TO_LABEL: Record<string, VictoryType> = {
  M: "Mission",
  D: "Combat",
  C: "Confrontation",
  F: "Forfeit",
};

// Starting HP for one player given who went first. Only used as the legacy
// fallback for pre-schemaVersion-2 rows that lack the `health` snapshot.
// Routes through startingHealthForSeat to keep the rule centralized.
const startingHP = (seat: number, firstPlayer: number) =>
  startingHealthForSeat(seat, firstPlayer).health;

// Final life for a row: prefer the persisted curHealth snapshot. The legacy
// fallback (starting HP minus `damage`) is wrong in general — `damage` is the
// per-turn attack pool, zeroed after each attack, not damage taken — but it's
// the best available signal for old rows.
const finalLife = (row: PlayerRow, firstPlayerIndex: number) =>
  row.health ?? Math.max(0, startingHP(row.playerIndex, firstPlayerIndex) - (row.damage ?? 0));

// Total mission progress for a row: sum of the seat's final rank on each
// mission. The legacy `mission` field is the per-turn spendable pool (≈0 at
// game end), so only fall back to it for rows without missionRanks.
const totalMission = (row: PlayerRow) =>
  row.missionRanks ? row.missionRanks.reduce((a, b) => a + b, 0) : (row.mission ?? 0);

function formatDate(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function useMatchHistory(userId: string | null): ChronicleEntry[] {
  // Step 1: fetch every matchPlayer row tied to the current user.
  const myRowsQuery = db.useQuery(
    userId ? { matchPlayers: { $: { where: { userId } } } } : null
  );
  const myRows = (myRowsQuery.data?.matchPlayers ?? []) as PlayerRow[];

  // Step 2: pull the corresponding matches + all opposing player rows in one go.
  const matchIds = useMemo(() => myRows.map((r) => r.matchId), [myRows]);
  const detailsQuery = db.useQuery(
    matchIds.length > 0
      ? {
          matches:      { $: { where: { id:      { $in: matchIds } } } },
          matchPlayers: { $: { where: { matchId: { $in: matchIds } } } },
        }
      : null
  );
  const matches    = (detailsQuery.data?.matches      ?? []) as MatchRow[];
  const allPlayers = (detailsQuery.data?.matchPlayers ?? []) as PlayerRow[];

  return useMemo<ChronicleEntry[]>(() => {
    if (!userId) return [];

    const playersByMatch = new Map<string, PlayerRow[]>();
    for (const p of allPlayers) {
      const arr = playersByMatch.get(p.matchId);
      if (arr) arr.push(p);
      else playersByMatch.set(p.matchId, [p]);
    }

    // Sort matches newest-first before mapping so the sidebar list comes
    // out in chronological order without needing createdAt on each entry.
    const sortedMatches = [...matches].sort(
      (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
    );

    return sortedMatches
      .map((m): ChronicleEntry | null => {
        const players = playersByMatch.get(m.id) ?? [];
        const myRow  = players.find((p) => p.userId === userId);
        const oppRow = players.find((p) => p !== myRow);
        if (!myRow || !oppRow) return null;

        const myPlayerIndex = myRow.playerIndex;
        const result: "win" | "loss" =
          m.winnerIndex === myPlayerIndex ? "win" : "loss";
        const firstPlayer: "me" | "opp" =
          m.firstPlayerIndex === myPlayerIndex ? "me" : "opp";

        const firstPlayerIndex = m.firstPlayerIndex ?? 0;
        const myLife  = finalLife(myRow, firstPlayerIndex);
        const oppLife = finalLife(oppRow, firstPlayerIndex);

        return {
          id: m.id,
          date: formatDate(m.createdAt),
          createdAt: m.createdAt ?? 0,
          opp: oppRow.name,
          kind: m.kind === "mp" ? "mp" : "bot",
          botType: m.botStrategy ? (m.botStrategy as BotType) : undefined,
          result,
          victory: VICTORY_LETTER_TO_LABEL[m.victoryType ?? ""] ?? "Mission",
          turn: m.turnCount ?? 0,
          firstPlayer,
          myChar: myRow.character,
          oppChar: oppRow.character,
          myLife,
          oppLife,
          myMission: totalMission(myRow),
          oppMission: totalMission(oppRow),
          myDeck: myRow.finalDeck ?? {},
          oppDeck: oppRow.finalDeck ?? {},
        };
      })
      .filter((e): e is ChronicleEntry => e !== null);
  }, [matches, allPlayers, userId]);
}
