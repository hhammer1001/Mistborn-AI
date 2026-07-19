/**
 * henryDivergence.ts — where does Henry play differently from Anvil, and who
 * is right?
 *
 * Replays Henry's recorded matches (henryReplayGen driver) and, at every
 * action decision Henry made, asks a SHADOW Anvil brain — the full
 * AnvilSecondBot stack (chain lookahead, lethal solver, opp-reply value
 * veto) run from Henry's seat via the seatGateOk override — what IT would
 * have played from the identical state. When they disagree, both candidate
 * actions are scored with the bot's own evaluation currency: end-of-turn
 * rollout P(win) including the opponent's simulated reply.
 *
 * Caveat: the shadow sits at Henry's index, so buildSnapshot's index-keyed
 * extras (anti-correlation, atium curve, opp-lead) don't fire — the shadow
 * is the veto+lookahead core, which is the shipped bot's main brain.
 *
 * Output: data/value_data_henry/divergence.json + console summary.
 * Run: npx tsx client/src/engine/henryDivergence.ts [maxMatches]
 */

import { writeFileSync } from "fs";
import type { GameSession } from "./session";
import type { Game } from "./game";
import { Player, copyPlayerState } from "./player";
import type { GameActionInternal } from "./types";
import { AnvilSecondBot, rolloutTurnEndValue } from "./anvilBot";
import { snapshotGame, restoreGame } from "./gameSnapshot";
import { loadMatches, replayMatch, type ReplayEvent } from "./henryReplayGen";

const MAX_MATCHES = parseInt(process.argv[2] || "999", 10);
// Sharding: [shard] [stride] — process matches where index % stride === shard.
const SHARD = parseInt(process.argv[3] || "0", 10);
const STRIDE = parseInt(process.argv[4] || "1", 10);
const OUT = new URL(`./data/value_data_henry/divergence${STRIDE > 1 ? `_${SHARD}` : ""}.json`, import.meta.url).pathname;

/** Full AnvilSecond stack, allowed to run from any seat. */
class ShadowAnvil extends AnvilSecondBot {
  protected override get seatGateOk(): boolean { return true; }
  scoreP(game: Game, action: GameActionInternal): number {
    // Value one candidate in the bot's own currency: perform, then rollout
    // to the post-opp-reply boundary and read P(win). Caller's game state is
    // restored here.
    const snap = snapshotGame(game);
    const self = this as Player & { _simulating?: boolean };
    const was = self._simulating;
    self._simulating = true;
    try {
      if (action.type !== "end_actions") {
        this.performAction(action, game);
        if (game.winner === this) return 2;
        if (game.winner) return -2;
        return rolloutTurnEndValue(this, game, this.rankFn) / 1000;
      }
      // Ending now: no further own actions, straight to attack + opp reply.
      return rolloutTurnEndValue(this, game, () => []) / 1000;
    } catch {
      return -1;
    } finally {
      self._simulating = was;
      restoreGame(game, snap);
    }
  }
}

/** Mirror Henry's live state into the shadow. copyPlayerState gives the
 * canonical scalar field list (fresh throwaway cardMap for its ally clones),
 * then deck/allies become SHARED references — the shadow acts on Henry's
 * actual board inside snapshot/restore. */
function syncShadow(shadow: Player, henry: Player): void {
  copyPlayerState(shadow, henry, new Map());
  shadow.deck = henry.deck;
  shadow.allies = henry.allies;
}

function describe(a: GameActionInternal): string {
  const parts: string[] = [a.type];
  const withCard = a as { card?: { name?: string } };
  if (withCard.card?.name) parts.push(withCard.card.name);
  const withMission = a as { mission?: { name?: string } };
  if (withMission.mission?.name) parts.push(withMission.mission.name);
  const withMetal = a as { metalIndex?: number };
  if (withMetal.metalIndex !== undefined) parts.push(`m${withMetal.metalIndex}`);
  return parts.join(":");
}

function sameAction(a: GameActionInternal, b: GameActionInternal): boolean {
  return describe(a) === describe(b);
}

interface Divergence {
  match: string;
  turn: number;
  character: string;
  henryWon: boolean;
  henry: string;
  anvil: string;
  pHenry: number;
  pAnvil: number;
  delta: number; // pAnvil - pHenry: >0 model prefers the bot's move
}

const { matches, players } = loadMatches();
const byMatch = new Map<string, typeof players>();
for (const p of players) {
  if (!byMatch.has(p.matchId)) byMatch.set(p.matchId, [] as typeof players);
  byMatch.get(p.matchId)!.push(p);
}

const divergences: Divergence[] = [];
let decisions = 0;
let agreements = 0;
let analyzed = 0;
const t0 = Date.now();

// Per-attempt buffers: failed replay attempts walk through garbage states
// (recorded indexes stop matching once a replay diverges), so nothing counts
// until the attempt passes the fidelity gate.
let bufDiv: Divergence[] = [];
let bufDecisions = 0;
let bufAgreements = 0;

let matchIdx = -1;
for (const m of matches) {
  matchIdx++;
  if (matchIdx % STRIDE !== SHARD) continue;
  if (analyzed >= MAX_MATCHES) break;
  if (m.forfeiter != null && m.forfeiter >= 0) continue;
  const mps = byMatch.get(m.id) ?? [];
  const henryWonMatch = m.winnerIndex === 0;
  const henryChar = mps.find((p) => p.playerIndex === 0)?.character ?? "?";

  let shadow: ShadowAnvil | null = null;
  const onHumanEvent = (session: GameSession, ev: ReplayEvent, humanIndex: number) => {
    if (ev.type !== "action") return; // v1: main action decisions only
    if (session.phase !== "actions") return;
    const game = session.game;
    const henry = game.players[humanIndex];
    // Populate the session's cached action list the recorded index refers to.
    session.getState(humanIndex);
    const raw = (session as unknown as { _cached_raw: GameActionInternal[] | null })._cached_raw;
    if (!raw) return;
    const idx = ev.args.actionIndex as number;
    if (idx < 0 || idx >= raw.length) return;
    const henryAction = raw[idx];
    bufDecisions++;

    if (!shadow) {
      shadow = new ShadowAnvil(henry.deck, game, henry.turnOrder, "Shadow", henry.character);
    }
    syncShadow(shadow, henry);

    let anvilAction: GameActionInternal;
    try {
      anvilAction = shadow.selectAction(raw.slice(), game);
    } catch {
      return;
    }
    if (sameAction(henryAction, anvilAction)) {
      bufAgreements++;
      return;
    }
    syncShadow(shadow, henry);
    const pHenry = shadow.scoreP(game, henryAction);
    syncShadow(shadow, henry);
    const pAnvil = shadow.scoreP(game, anvilAction);
    bufDiv.push({
      match: m.id,
      turn: game.turncount,
      character: henryChar,
      henryWon: henryWonMatch,
      henry: describe(henryAction),
      anvil: describe(anvilAction),
      pHenry,
      pAnvil,
      delta: pAnvil - pHenry,
    });
  };

  bufDiv = []; bufDecisions = 0; bufAgreements = 0;
  let res = replayMatch(m, mps, false, onHumanEvent);
  if (!res.ok) {
    shadow = null;
    bufDiv = []; bufDecisions = 0; bufAgreements = 0; // attempt 1 was garbage
    res = replayMatch(m, mps, true, onHumanEvent);
  }
  if (!res.ok) continue;
  divergences.push(...bufDiv);
  decisions += bufDecisions;
  agreements += bufAgreements;
  analyzed++;
  if (analyzed % 25 === 0) {
    console.log(`${analyzed} matches, ${decisions} decisions, ${divergences.length} divergences (${((Date.now() - t0) / 60000).toFixed(1)}m)`);
  }
}

// ── Summary ──
const div = divergences;
const agreeRate = decisions > 0 ? agreements / decisions : 0;
console.log(`\nanalyzed ${analyzed} matches | ${decisions} Henry decisions | agreement ${(agreeRate * 100).toFixed(1)}%`);

const won = div.filter((d) => d.henryWon);
const lost = div.filter((d) => !d.henryWon);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
console.log(`divergences: ${div.length} (in wins: ${won.length}, in losses: ${lost.length})`);
console.log(`mean (pAnvil - pHenry): wins ${mean(won.map((d) => d.delta)).toFixed(3)} | losses ${mean(lost.map((d) => d.delta)).toFixed(3)}`);
console.log(`Henry's move scored HIGHER by the model: wins ${(100 * won.filter((d) => d.delta < 0).length / Math.max(1, won.length)).toFixed(1)}% | losses ${(100 * lost.filter((d) => d.delta < 0).length / Math.max(1, lost.length)).toFixed(1)}%`);

// Action-type disagreement patterns
const pat = new Map<string, { n: number; dsum: number }>();
for (const d of div) {
  const key = `${d.henry.split(":")[0]} vs ${d.anvil.split(":")[0]}`;
  const e = pat.get(key) ?? { n: 0, dsum: 0 };
  e.n++; e.dsum += d.delta;
  pat.set(key, e);
}
console.log("\ntop disagreement patterns (Henry vs Anvil, n>=15):");
for (const [k, v] of [...pat.entries()].filter(([, v]) => v.n >= 15).sort((a, b) => b[1].n - a[1].n).slice(0, 12)) {
  console.log(`  ${k}: n=${v.n}, mean delta ${(v.dsum / v.n).toFixed(3)} ${v.dsum / v.n < 0 ? "(Henry better per model)" : "(Anvil better per model)"}`);
}

// Biggest individual "Henry knew better" moments in games he won
console.log("\ntop 12 'Henry >> Anvil' decisions in his WINS (model agrees in hindsight-free eval):");
for (const d of won.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 12)) {
  console.log(`  t${d.turn} ${d.character}: Henry ${d.henry} (${d.pHenry.toFixed(2)}) vs Anvil ${d.anvil} (${d.pAnvil.toFixed(2)})`);
}

writeFileSync(OUT, JSON.stringify({ analyzed, decisions, agreements, divergences }, null, 1));
console.log(`\nwrote ${OUT}`);
