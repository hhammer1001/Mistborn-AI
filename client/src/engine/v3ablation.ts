/**
 * v3ablation.ts — going-first ablation harness for SquashV2 config experiments.
 *
 * Runs SquashV2 (going first, seat 0) vs Zoom (going second, seat 1) on
 * deterministic seeds, applying a JSON patch to SquashV2Config first so
 * different configs are compared on identical games.
 *
 * Run:
 *   npx tsx client/src/engine/v3ablation.ts '<jsonPatch>' [gamesPerMatchup=50] [seedOffset=1] [opponent=Zoom]
 *
 * Examples:
 *   npx tsx client/src/engine/v3ablation.ts '{}'                         # baseline
 *   npx tsx client/src/engine/v3ablation.ts '{"oppLeadAwareness":false}' # ablate opp-lead penalty
 */

import { Game, type PlayerFactory } from "./game";
import { createZoomBot } from "./zoomBot";
import { createSquashBot } from "./squashBot";
import { createTwonky } from "./bot";
import { createSquashV2Bot } from "./squashV2Bot";
import { resetCardIds } from "./card";
import { SquashV2Config } from "./squashBotEval";
import { SquashV2Bot } from "./squashV2Bot";

const OPP_FACTORIES: Record<string, PlayerFactory> = {
  Zoom: createZoomBot as PlayerFactory,
  Squash: createSquashBot as PlayerFactory,
  V1: createTwonky as PlayerFactory,
  SquashV2: createSquashV2Bot as PlayerFactory,
};

const args = process.argv.slice(2);
const patch = JSON.parse(args[0] || "{}");
const gamesPerMatchup = parseInt(args[1] || "50", 10);
const seedOffset = parseInt(args[2] || "1", 10);
const oppName = args[3] || "Zoom";
const fOpp = OPP_FACTORIES[oppName];

// Bot-static overrides live under "_bot": {lookaheadDepth, lookaheadTopK, followupWeight, lethalThreshold}
if (patch._bot) {
  for (const [k, v] of Object.entries(patch._bot)) (SquashV2Bot as any)[k] = v;
  delete patch._bot;
}

// Apply config patch (deep-merge one level for objects like buyBufferOverride).
for (const [k, v] of Object.entries(patch)) {
  if (v && typeof v === "object" && !Array.isArray(v) && typeof (SquashV2Config as any)[k] === "object") {
    Object.assign((SquashV2Config as any)[k], v);
  } else {
    (SquashV2Config as any)[k] = v;
  }
}

const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];

let totalWins = 0;
let totalGames = 0;
const vt: Record<string, number> = { M: 0, D: 0, C: 0, F: 0, T: 0 };
// turn buckets: short <18, mid 18-22, long 23+
const bucket = {
  short: { w: 0, n: 0 },
  mid: { w: 0, n: 0 },
  long: { w: 0, n: 0 },
};
// per-bot-character (the going-first SquashV2 character)
const byChar: Record<string, { w: number; n: number }> = {};
for (const c of chars) byChar[c] = { w: 0, n: 0 };

let matchupIdx = 0;
for (const cFirst of chars) {
  for (const cSecond of chars) {
    if (cFirst === cSecond) continue;
    for (let i = 0; i < gamesPerMatchup; i++) {
      resetCardIds();
      const seed = seedOffset + matchupIdx * 1000003 + i;
      const game = new Game({
        playerFactories: [createSquashV2Bot as PlayerFactory, fOpp],
        names: ["SquashV2", oppName],
        chars: [cFirst, cSecond],
        seed,
      });
      const winner = game.play();
      const won = winner.name === "SquashV2";
      totalGames++;
      byChar[cFirst].n++;
      if (won) {
        totalWins++;
        byChar[cFirst].w++;
        if (game.victoryType in vt) vt[game.victoryType]++;
      }
      const t = game.turncount;
      const b = t < 18 ? bucket.short : t < 23 ? bucket.mid : bucket.long;
      b.n++;
      if (won) b.w++;
    }
    matchupIdx++;
  }
}

const pct = (w: number, n: number) => (n > 0 ? (w / n * 100).toFixed(1) : "N/A");
console.log(`\nPATCH: ${JSON.stringify(patch)}`);
console.log(`SquashV2 (first) vs ${oppName} (second) — ${gamesPerMatchup}/matchup, seedOffset=${seedOffset}`);
console.log(`OVERALL: ${totalWins}/${totalGames} (${pct(totalWins, totalGames)}%)`);
console.log(`  by turn-length:  short<18 ${pct(bucket.short.w, bucket.short.n)}% (n=${bucket.short.n}) | mid18-22 ${pct(bucket.mid.w, bucket.mid.n)}% (n=${bucket.mid.n}) | long23+ ${pct(bucket.long.w, bucket.long.n)}% (n=${bucket.long.n})`);
console.log(`  by bot character: ` + chars.map((c) => `${c} ${pct(byChar[c].w, byChar[c].n)}%`).join(" | "));
console.log(`  win-type dist (SquashV2 wins only): ${JSON.stringify(vt)}`);
