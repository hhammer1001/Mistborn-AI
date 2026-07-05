import type { CardData, GameState, MissionData, PlayerData } from "../types/game";
import type { LogEntry } from "../hooks/useGame";
import { METAL_NAMES } from "../engine/types";
import { CHARACTER_DEFS } from "../engine/data/characters";
import { startingHealthForSeat } from "../engine/player";

/** Match row shape as returned by the InstantDB query. The fields used by
 *  reconstruction are listed explicitly; everything else is left optional. */
export interface MatchRow {
  id: string;
  kind?: "mp" | "bot";
  botStrategy?: string;
  createdAt?: number;
  endedAt?: number;
  turnCount?: number;
  firstPlayerIndex?: 0 | 1;
  winnerIndex?: 0 | 1;
  victoryType?: string;
  missionNames?: string[];
  testDeck?: boolean;
  seed?: number;
  schemaVersion?: number;
  missionState?: MissionData[];
  activityLog?: { p0: LogEntry[]; p1: LogEntry[] };
}

export interface PlayerRow {
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
  metalTokens?: number[];
  metalAvailable?: number[];
  metalBurned?: number[];
  missionRanks?: number[];
  // Snapshot fields (schemaVersion >= 2)
  health?: number;
  money?: number;
  boxings?: number;
  pDamage?: number;
  pMoney?: number;
  charAbility1?: boolean;
  charAbility2?: boolean;
  charAbility3?: boolean;
  finalHand?: CardData[];
  finalDiscard?: CardData[];
  finalLibrary?: CardData[];
  finalAllies?: CardData[];
}

export interface ReconstructedPostgame {
  gameState: GameState;
  you: PlayerData;
  opp: PlayerData;
  log: LogEntry[];
  youWon: boolean;
}

/** True when the match record carries the full postgame snapshot (added in
 *  schemaVersion 2). Older matches only have summary stats; the caller should
 *  fall back to a stripped-down view. */
export function hasFullSnapshot(m: MatchRow, players: PlayerRow[]): boolean {
  if (!m.missionState || !m.activityLog) return false;
  return players.every(
    (p) => p.finalHand !== undefined && p.finalDiscard !== undefined && p.finalLibrary !== undefined,
  );
}

function buildPlayerData(p: PlayerRow, firstPlayerIndex: 0 | 1): PlayerData {
  const charDef = CHARACTER_DEFS[p.character];
  const ability1metal = charDef ? String(charDef.ability1Metal) : "0";
  const ability1effect = charDef?.ability1Effect ?? "D";
  const ability1amount = charDef?.ability1Amount ?? "1";

  const startingHP = startingHealthForSeat(p.playerIndex, firstPlayerIndex).health;
  const health = p.health ?? Math.max(0, startingHP - (p.damage ?? 0));

  const hand = p.finalHand ?? [];
  const discard = p.finalDiscard ?? [];
  const library = p.finalLibrary ?? [];
  const allies = p.finalAllies ?? [];

  return {
    name: p.name,
    character: p.character,
    turnOrder: p.playerIndex,
    alive: health > 0,
    health,
    damage: p.damage ?? 0,
    money: p.money ?? 0,
    mission: p.mission ?? 0,
    boxings: p.boxings ?? 0,
    hand,
    handSize: hand.length,
    deckSize: library.length,
    discardSize: discard.length,
    discard,
    deck: library,
    allies,
    metalTokens: p.metalTokens ?? new Array(9).fill(0),
    metalAvailable: p.metalAvailable ?? new Array(9).fill(0),
    metalBurned: p.metalBurned ?? new Array(9).fill(0),
    metalNames: [...METAL_NAMES],
    burns: p.burns ?? 0,
    atium: p.atium ?? 0,
    training: p.training ?? 0,
    maxHandSize: 5, // not snapshotted; permDraw bumps are rare and cosmetic here
    pDamage: p.pDamage ?? 0,
    pMoney: p.pMoney ?? 0,
    charAbility1: p.charAbility1 ?? false,
    charAbility2: p.charAbility2 ?? false,
    charAbility3: p.charAbility3 ?? false,
    ability1metal,
    ability1effect,
    ability1amount,
  };
}

/** Rehydrate a saved match into the shape the live GameOverScreen consumes.
 *  `perspective` picks which side renders as "you". Returns null when the
 *  match predates the schemaVersion-2 snapshot and we can't fully rebuild. */
export function reconstructPostgame(
  match: MatchRow,
  players: PlayerRow[],
  perspective: 0 | 1,
): ReconstructedPostgame | null {
  if (!hasFullSnapshot(match, players)) return null;

  const p0 = players.find((p) => p.playerIndex === 0);
  const p1 = players.find((p) => p.playerIndex === 1);
  if (!p0 || !p1) return null;

  const firstPlayerIndex = (match.firstPlayerIndex ?? 0) as 0 | 1;
  const youData = buildPlayerData(perspective === 0 ? p0 : p1, firstPlayerIndex);
  const oppData = buildPlayerData(perspective === 0 ? p1 : p0, firstPlayerIndex);

  // Merge per-player activity streams into a single chronological log. Each
  // stream's entries already carry a `turn`; tag opponent-side entries with
  // `isBot: true` so the existing ActivityLog renders them in opponent style.
  const myStream = perspective === 0 ? match.activityLog!.p0 : match.activityLog!.p1;
  const oppStream = perspective === 0 ? match.activityLog!.p1 : match.activityLog!.p0;
  const log: LogEntry[] = [
    ...myStream.map((e) => ({ ...e })),
    ...oppStream.map((e) => ({ ...e, isBot: true })),
  ];
  log.sort((a, b) => a.turn - b.turn);

  const gameState: GameState = {
    sessionId: match.id,
    phase: "game_over",
    // Seat of the viewer — perspective-aware components (MissionTrack's
    // you/opp bars) need this since missions/players stay seat-ordered.
    myPlayerIndex: perspective,
    turnCount: match.turnCount ?? 0,
    winner: null,
    victoryType: match.victoryType ?? null,
    metalCodes: [...METAL_NAMES],
    market: { hand: [], deckSize: 0, discardSize: 0, discard: [] },
    missions: match.missionState ?? [],
    players: [
      perspective === 0 ? youData : oppData,
      perspective === 0 ? oppData : youData,
    ],
    availableActions: [],
  };

  const youWon = (match.winnerIndex ?? -1) === perspective;
  return { gameState, you: youData, opp: oppData, log, youWon };
}
