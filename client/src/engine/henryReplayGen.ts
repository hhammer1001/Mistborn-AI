/**
 * henryReplayGen.ts — reconstruct Henry's recorded matches into value-model
 * training rows by deterministic replay.
 *
 * Matches store the root seed + a structured actionLog where human moves map
 * 1:1 to GameSession entry-points and bot moves regenerate from the seed
 * (session.ts ActionEvent docs). We rebuild each match in a fresh
 * GameSession, feed the recorded human events, and capture dual-phase
 * feature rows at every turn boundary (game.attack), exactly like
 * valueDataGen.
 *
 * FIDELITY GATE: a replay only produces rows if its end state reproduces the
 * stored ground truth (winnerIndex, victoryType, turnCount, per-player
 * missionRanks + training). Engine changes since a match was recorded break
 * determinism — those matches are dropped, not approximated. Pre-SquashV3
 * matches are retried with SquashV3's flags disabled (= exact SquashV2).
 *
 * Run:
 *   npx tsx client/src/engine/henryReplayGen.ts fetch     # pull matches -> data/henry_matches.json
 *   npx tsx client/src/engine/henryReplayGen.ts replay    # replay + emit rows/report
 * Output: data/value_data_henry/henry.csv (+ henry_meta.json report)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { GameSession, opponentTypeToKind } from "./session";
import type { Game } from "./game";
import type { Player } from "./player";
import { resetCardIds } from "./card";
import { SquashV3Bot } from "./squashV3Bot";
import { featurize } from "./valueModel";

const APP_ID = "f31200dd-1c19-4cb6-9187-2e4cf731bb55";
const HENRY_USER_ID = "a8115d46-6e2c-4b84-a964-1246d2d9d564";
const TOKEN_PATH = new URL("../../../.claude/skills/analyze-bot-games/token.local.txt", import.meta.url).pathname;
const DATA_DIR = new URL("./data/value_data_henry/", import.meta.url).pathname;
const MATCHES_JSON = `${DATA_DIR}henry_matches.json`;

export interface MatchRow {
  id: string;
  kind: string;
  botStrategy?: string;
  victoryType?: string;
  winnerIndex?: number;
  firstPlayerIndex?: number;
  forfeiter?: number | null;
  turnCount?: number;
  seed?: number;
  createdAt?: number | string;
  actionLog?: { type: string; playerIndex: 0 | 1; args: Record<string, unknown>; turncount: number }[];
}
export interface MatchPlayerRow {
  matchId: string;
  playerIndex: number;
  userId?: string;
  character: string;
  isBot?: boolean;
  training?: number;
  missionRanks?: number[];
}

async function fetchAll(): Promise<void> {
  const token = readFileSync(TOKEN_PATH, "utf8").trim();
  const q = async (query: unknown) => {
    const res = await fetch("https://api.instantdb.com/admin/query", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "App-Id": APP_ID, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`InstantDB ${res.status}: ${await res.text()}`);
    return res.json();
  };

  const mres = await q({ matches: { $: { where: { kind: "bot" }, limit: 1000 } } });
  const matches = (mres.matches ?? []) as MatchRow[];
  console.log(`fetched ${matches.length} bot matches`);

  const ids = matches.map((m) => m.id);
  const players: MatchPlayerRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const pres = await q({ matchPlayers: { $: { where: { matchId: { $in: ids.slice(i, i + 100) } } } } });
    players.push(...((pres.matchPlayers ?? []) as MatchPlayerRow[]));
  }
  console.log(`fetched ${players.length} matchPlayers`);

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MATCHES_JSON, JSON.stringify({ matches, players }));
  console.log(`wrote ${MATCHES_JSON}`);
}

// ── Replay ──

type Row = { seat: number; isHenry: boolean; turn: number; feats: number[] };

/** Hook game.attack to capture dual-phase rows at each turn boundary (the
 * same phase points valueDataGen captures). Skips simulated attacks. */
function hookCapture(game: Game, rows: Row[], henryIndex: number): void {
  const orig = game.attack.bind(game);
  (game as Game).attack = (p: Player) => {
    const result = orig(p);
    const sim = (p as Player & { _simulating?: boolean })._simulating;
    if (!sim && !game.winner) {
      const saved = p.curDamage;
      p.curDamage = 0; // capture the post-playTurn distribution (damage reset)
      const opp = game.players[(p.turnOrder + 1) % 2];
      rows.push({ seat: p.turnOrder, isHenry: p.turnOrder === henryIndex, turn: game.turncount, feats: featurize(p, game, 0) });
      rows.push({ seat: opp.turnOrder, isHenry: opp.turnOrder === henryIndex, turn: game.turncount, feats: featurize(opp, game, 1) });
      p.curDamage = saved;
    }
    return result;
  };
}

export interface ReplayResult {
  ok: boolean;
  reason?: string;
  rows: Row[];
}

export type ReplayEvent = { type: string; playerIndex: 0 | 1; args: Record<string, unknown>; turncount: number };

/** Replay one recorded match. `onHumanEvent` (if given) fires BEFORE each
 * human-originated event is applied — the session is exactly at the state
 * where the human made that decision. Used by the divergence analyzer. */
export function replayMatch(
  m: MatchRow,
  mps: MatchPlayerRow[],
  v2Mode: boolean,
  onHumanEvent?: (session: GameSession, ev: ReplayEvent, humanIndex: number) => void,
): ReplayResult {
  const p0 = mps.find((p) => p.playerIndex === 0);
  const p1 = mps.find((p) => p.playerIndex === 1);
  if (!p0 || !p1 || m.seed === undefined || !m.actionLog?.length) return { ok: false, reason: "missing data", rows: [] };
  const henryIndex = p0.userId === HENRY_USER_ID ? 0 : 1;
  const humanIndex = p0.isBot ? 1 : 0;
  const botIndex = 1 - humanIndex;
  const botKind = opponentTypeToKind(m.botStrategy ?? "hulk");

  // Pre-SquashV3 replays: disable V3's behavior flags => exact SquashV2.
  const flags = {
    nopen: SquashV3Bot.flagRaceNoPenalty, cardPlay: SquashV3Bot.flagCardPlay,
  };
  if (v2Mode) { SquashV3Bot.flagRaceNoPenalty = false; SquashV3Bot.flagCardPlay = false; }

  const rows: Row[] = [];
  try {
    resetCardIds();
    const players = [
      { kind: "human" as const, name: "Henry", character: p0.character },
      { kind: botKind, name: "Bot", character: p1.character },
    ];
    if (humanIndex === 1) {
      players.reverse();
      players[0].kind = botKind; players[0].character = p0.character;
      players[1].kind = "human" as const; players[1].character = p1.character;
    }
    const session = new GameSession({
      seed: m.seed,
      firstPlayer: (m.firstPlayerIndex ?? 0) as 0 | 1,
      players: players as [typeof players[0], typeof players[1]],
    });
    hookCapture(session.game, rows, henryIndex);

    for (const ev of m.actionLog) {
      if (ev.type === "bot_action") continue; // regenerated deterministically
      if (session.phase === "game_over") break;
      if (onHumanEvent && ev.playerIndex === humanIndex) onHumanEvent(session, ev as ReplayEvent, humanIndex);
      const a = ev.args ?? {};
      let r: Record<string, unknown>;
      switch (ev.type) {
        case "action": r = session.playAction(ev.playerIndex, a.actionIndex as number); break;
        case "composite": r = session.playComposite(ev.playerIndex, a.firstIndex as number, a.secondMatch as { code: number; cardIds?: number[] }); break;
        case "advance_all": r = session.advanceAllMission(ev.playerIndex, a.missionName as string); break;
        case "prompt": r = session.respondToPrompt(ev.playerIndex, a.promptType as string, a.value as number | boolean); break;
        case "damage": r = session.assignDamage(ev.playerIndex, a.targetIndex as number); break;
        case "ally_defense": r = session.resolveAllyDefense(ev.playerIndex, a.cardId as number); break;
        case "sense": r = session.resolveSense(ev.playerIndex, a.cardId == null ? [] : [a.cardId as number]); break;
        case "cloud": r = session.resolveCloud(ev.playerIndex, (a.cardIds ?? []) as number[]); break;
        case "forfeit": r = session.forfeit(ev.playerIndex); break;
        default: return { ok: false, reason: `unknown event ${ev.type}`, rows: [] };
      }
      if (r && typeof r === "object" && "error" in r && r.error) {
        return { ok: false, reason: `event rejected: ${ev.type} (${String(r.error)})`, rows: [] };
      }
    }

    // Fidelity gate vs stored ground truth.
    const g = session.game;
    const storedWinner = m.winnerIndex;
    const gotWinner = g.winner ? g.winner.turnOrder : null;
    if (m.forfeiter == null || m.forfeiter < 0) {
      if (gotWinner !== storedWinner) return { ok: false, reason: `winner mismatch (${gotWinner} vs ${storedWinner})`, rows: [] };
      if ((m.victoryType ?? "") !== g.victoryType) return { ok: false, reason: `victoryType mismatch`, rows: [] };
    }
    if (m.turnCount !== undefined && Math.abs(g.turncount - m.turnCount) > 0) {
      return { ok: false, reason: `turnCount mismatch (${g.turncount} vs ${m.turnCount})`, rows: [] };
    }
    for (const mp of [p0, p1]) {
      if (mp.missionRanks) {
        const got = g.missions.map((mi) => mi.playerRanks[mp.playerIndex]);
        if (JSON.stringify(got) !== JSON.stringify(mp.missionRanks)) {
          return { ok: false, reason: `missionRanks mismatch p${mp.playerIndex}`, rows: [] };
        }
      }
      if (mp.training !== undefined && g.players[mp.playerIndex].training !== mp.training) {
        return { ok: false, reason: `training mismatch p${mp.playerIndex}`, rows: [] };
      }
    }
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, reason: `exception: ${(e as Error).message?.slice(0, 80)}`, rows: [] };
  } finally {
    SquashV3Bot.flagRaceNoPenalty = flags.nopen;
    SquashV3Bot.flagCardPlay = flags.cardPlay;
  }
}

export function loadMatches(): { matches: MatchRow[]; players: MatchPlayerRow[] } {
  return JSON.parse(readFileSync(MATCHES_JSON, "utf8")) as { matches: MatchRow[]; players: MatchPlayerRow[] };
}

async function replayAll(): Promise<void> {
  const { matches, players } = loadMatches();
  const byMatch = new Map<string, MatchPlayerRow[]>();
  for (const p of players) {
    if (!byMatch.has(p.matchId)) byMatch.set(p.matchId, []);
    byMatch.get(p.matchId)!.push(p);
  }

  const lines: string[] = [];
  const report: Record<string, number> = {};
  const failReasons: Record<string, number> = {};
  let kept = 0, henryRows = 0;
  let idx = 0;
  for (const m of matches) {
    idx++;
    const mps = byMatch.get(m.id) ?? [];
    if (m.forfeiter != null && m.forfeiter >= 0) { report.forfeit = (report.forfeit ?? 0) + 1; continue; }
    let res = replayMatch(m, mps, false);
    if (!res.ok) {
      const retry = replayMatch(m, mps, true); // pre-V3-era bot
      if (retry.ok) res = retry;
    }
    if (!res.ok) {
      report.failed = (report.failed ?? 0) + 1;
      failReasons[res.reason ?? "?"] = (failReasons[res.reason ?? "?"] ?? 0) + 1;
      continue;
    }
    kept++;
    const gameKey = 90_000_000 + idx;
    const winnerIdx = m.winnerIndex!;
    for (const r of res.rows) {
      const label = r.seat === winnerIdx ? 1 : 0;
      // extra trailing metadata cols (isHenry, turn) — valueTrain ignores
      // lines whose column count mismatches, so henry rows get their own
      // loader; the shared prefix keeps formats aligned.
      lines.push(`${gameKey},${label},${r.feats.map((x) => Math.round(x * 10000) / 10000).join(",")},${r.isHenry ? 1 : 0},${r.turn}`);
      if (r.isHenry) henryRows++;
    }
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(`${DATA_DIR}henry.csv`, lines.join("\n") + "\n");
  writeFileSync(`${DATA_DIR}henry_meta.json`, JSON.stringify({ matches: matches.length, kept, rows: lines.length, henryRows, report, failReasons }, null, 2));
  console.log(`kept ${kept}/${matches.length} matches, ${lines.length} rows (${henryRows} Henry-perspective)`);
  console.log("skips:", JSON.stringify(report), "fail reasons:", JSON.stringify(failReasons));
}

// CLI — only when this file is the entry module (it is also imported as a
// library by henryDivergence.ts, whose argv must not trigger this).
if (process.argv[1]?.includes("henryReplayGen")) {
  const mode = process.argv[2];
  if (mode === "fetch") fetchAll().catch((e) => { console.error(e); process.exit(1); });
  else if (mode === "replay") replayAll().catch((e) => { console.error(e); process.exit(1); });
  else { console.error("Usage: henryReplayGen.ts <fetch|replay>"); process.exit(1); }
}
