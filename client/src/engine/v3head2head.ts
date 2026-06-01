/**
 * v3head2head.ts — pit a seat-0 (going-first) bot against a seat-1 bot on
 * identical deterministic seeds across all character matchups.
 *
 * Run:
 *   npx tsx client/src/engine/v3head2head.ts [seat0=SquashV3] [seat1=SquashV2] [games=50] [seed=1] [econ=1] [race=1]
 *
 * The econ/race args toggle SquashV3Bot's two experimental flags so each can be
 * ablated independently.
 */
import { Game, type PlayerFactory } from "./game";
import { createZoomBot } from "./zoomBot";
import { createSquashBot } from "./squashBot";
import { createTwonky } from "./bot";
import { createSquashV2Bot } from "./squashV2Bot";
import { createSquashV3Bot, SquashV3Bot } from "./squashV3Bot";
import { resetCardIds } from "./card";
import { setSquashV2SelfPlayWeights } from "./squashBotEval";
import { readFileSync } from "fs";

// Optional: load an alternate SquashV2 base weight set (A/B differently-trained
// weights). WEIGHTS_DIR points at a dir of <Character>.json files. Only affects
// the squashV2 profile, so opponents must be non-squashV2 (Zoom/Squash/V1) for
// a clean comparison.
if (process.env.WEIGHTS_DIR) {
  const dir = process.env.WEIGHTS_DIR;
  const w: Record<string, Record<string, [number, number, number]>> = {};
  for (const c of ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"]) {
    w[c] = JSON.parse(readFileSync(`${dir}/${c}.json`, "utf8"));
  }
  setSquashV2SelfPlayWeights(w);
  console.log(`Loaded alternate weights from ${dir}`);
}

const F: Record<string, PlayerFactory> = {
  SquashV2: createSquashV2Bot as PlayerFactory,
  SquashV3: createSquashV3Bot as PlayerFactory,
  Zoom: createZoomBot as PlayerFactory,
  Squash: createSquashBot as PlayerFactory,
  V1: createTwonky as PlayerFactory,
};

const a = process.argv.slice(2);
const s0 = a[0] || "SquashV3";
const s1 = a[1] || "SquashV2";
const games = parseInt(a[2] || "50", 10);
const seedOffset = parseInt(a[3] || "1", 10);
// Flag control via FLAGS env var: comma-separated list of experimental flags to
// turn ON. When FLAGS is set, ALL experimental flags start OFF then the listed
// ones are enabled — clean attribution. When FLAGS is unset, keep class
// defaults (the locked-in validated config). Vocabulary:
//   nopen   — skip opp-lead penalty on own mission path (validated +0.8pp)
//   close   — extend "about to win" push to completedMissions>=1 (inert)
//   econ    — aggressive boxing redemption (rejected -3.5pp)
//   racing  — turns-to-win race-press on mission advance
//   defense — boost heal/defender valuation under damage-race pressure
const flagsEnv = process.env.FLAGS;
if (flagsEnv !== undefined) {
  const on = new Set(flagsEnv.split(",").map((s) => s.trim()).filter(Boolean));
  SquashV3Bot.flagEconomy = on.has("econ");
  SquashV3Bot.flagRaceNoPenalty = on.has("nopen");
  SquashV3Bot.flagRaceClose = on.has("close");
  SquashV3Bot.flagRacing = on.has("racing");
  SquashV3Bot.flagDefense = on.has("defense");
  SquashV3Bot.flagRace = true; // umbrella; sub-flags above gate behavior
}
// Card-play knobs via env: FLARECOST, BURNMETALCOST, EARLYBURN (any set => flagCardPlay on)
if (process.env.FLARECOST !== undefined) { SquashV3Bot.flagCardPlay = true; SquashV3Bot.flareCost = parseFloat(process.env.FLARECOST); }
if (process.env.BURNMETALCOST !== undefined) { SquashV3Bot.flagCardPlay = true; SquashV3Bot.burnMetalCost = parseFloat(process.env.BURNMETALCOST); }
if (process.env.EARLYBURN !== undefined) { SquashV3Bot.flagCardPlay = true; SquashV3Bot.earlyBurnBonus = parseFloat(process.env.EARLYBURN); }

const ALL = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
// Optional character filters: SEAT0CHAR / SEAT1CHAR (comma lists) restrict the matrix.
const seat0chars = process.env.SEAT0CHAR ? process.env.SEAT0CHAR.split(",") : ALL;
const seat1chars = process.env.SEAT1CHAR ? process.env.SEAT1CHAR.split(",") : ALL;
const chars = ALL;
let s0wins = 0, total = 0;
const bucket = { short: { w: 0, n: 0 }, mid: { w: 0, n: 0 }, long: { w: 0, n: 0 } };
const byChar: Record<string, { w: number; n: number }> = {};
for (const c of chars) byChar[c] = { w: 0, n: 0 };

let matchupIdx = 0;
for (const c0 of chars) {
  for (const c1 of chars) {
    if (c0 === c1) continue;
    if (!seat0chars.includes(c0) || !seat1chars.includes(c1)) { matchupIdx++; continue; }
    for (let i = 0; i < games; i++) {
      resetCardIds();
      const seed = seedOffset + matchupIdx * 1000003 + i;
      const game = new Game({
        playerFactories: [F[s0], F[s1]],
        names: [s0 + "_0", s1 + "_1"],
        chars: [c0, c1],
        seed,
      });
      const winner = game.play();
      const won = winner.name === s0 + "_0";
      total++; byChar[c0].n++;
      if (won) { s0wins++; byChar[c0].w++; }
      const t = game.turncount;
      const b = t < 18 ? bucket.short : t < 23 ? bucket.mid : bucket.long;
      b.n++; if (won) b.w++;
    }
    matchupIdx++;
  }
}

const pct = (w: number, n: number) => (n > 0 ? (w / n * 100).toFixed(1) : "N/A");
console.log(`\n${s0} (seat0/first) vs ${s1} (seat1/second) — ${games}/matchup, seed=${seedOffset}`);
console.log(`flags: econ=${SquashV3Bot.flagEconomy} nopen=${SquashV3Bot.flagRaceNoPenalty} close=${SquashV3Bot.flagRaceClose} racing=${SquashV3Bot.flagRacing} defense=${SquashV3Bot.flagDefense}`);
console.log(`SEAT0 WINS: ${s0wins}/${total} (${pct(s0wins, total)}%)   [50% = no difference vs ${s1}]`);
console.log(`  by turn-length: short<18 ${pct(bucket.short.w, bucket.short.n)}% (n=${bucket.short.n}) | mid18-22 ${pct(bucket.mid.w, bucket.mid.n)}% (n=${bucket.mid.n}) | long23+ ${pct(bucket.long.w, bucket.long.n)}% (n=${bucket.long.n})`);
console.log(`  by seat0 char: ` + chars.map((c) => `${c} ${pct(byChar[c].w, byChar[c].n)}%`).join(" | "));
