/**
 * anvilBench.ts — seeded benchmarks for the Anvil bot.
 *
 * Modes:
 *   seat0 <opp> <games> <seed>   Anvil seat0 vs <opp> seat1, all char pairs
 *   seat1 <opp> <games> <seed>   <opp> seat0 vs Anvil seat1, all char pairs
 *   flip  <opp> <games> <seed>   coin-flipped seats (i%2), all char pairs
 *
 * Loads evolved policies from data/anvil_evolve/*.json unless ANVIL_ZERO=1.
 * Restrict which evolved policies load with ANVIL_CHARS=Kelsier,Vin and
 * ANVIL_SEATS=first,second (both optional, default all accepted policies).
 *
 * Run:  npx tsx client/src/engine/anvilBench.ts flip Hulk 100 1
 */

import { readFileSync, existsSync } from "fs";
import { Game, type PlayerFactory } from "./game";
import { resetCardIds } from "./card";
import { createTwonky } from "./bot";
import { createSquashBot } from "./squashBot";
import { createZoomBot } from "./zoomBot";
import { createSquashV2Bot } from "./squashV2Bot";
import { createSquashV3Bot } from "./squashV3Bot";
import { createHulkX90 } from "./hulkX90Bot";
import { createAnvilBot, setAnvilPolicy, AnvilSecondBot, AnvilFirstBot, type AnvilDeltas, type AnvilKnobs } from "./anvilBot";

// Value-model integration is ON by default (shipped veto config). Override:
//   ANVIL_VALUE_LEAF=0            — disable entirely (paired controls)
//   ANVIL_VL_VETO=<m> / ANVIL_VL_BLEND=<b> / ANVIL_VL_TOPK=<k> — experiment
if (process.env.ANVIL_VALUE_LEAF === "0") {
  AnvilSecondBot.valueLeafEnabled = false;
  console.log("Value-leaf mode OFF (ANVIL_VALUE_LEAF=0)");
} else {
  if (process.env.ANVIL_VL_TOPK) AnvilSecondBot.valueLeafTopK = parseInt(process.env.ANVIL_VL_TOPK, 10);
  if (process.env.ANVIL_VL_BLEND) { AnvilSecondBot.valueBlend = parseFloat(process.env.ANVIL_VL_BLEND); AnvilSecondBot.valueVetoMargin = 0; }
  if (process.env.ANVIL_VL_VETO) AnvilSecondBot.valueVetoMargin = parseFloat(process.env.ANVIL_VL_VETO);
  if (process.env.ANVIL_VL_SEAT0) AnvilFirstBot.valueVetoMargin = parseFloat(process.env.ANVIL_VL_SEAT0);
  if (process.env.ANVIL_BE_DAMP) AnvilSecondBot.buyElimDamp = parseFloat(process.env.ANVIL_BE_DAMP);
  if (process.env.ANVIL_BURST === "1") { AnvilFirstBot.missionBurstEnabled = true; AnvilSecondBot.missionBurstEnabled = true; console.log("Mission-burst solver ON"); }
  console.log(`Value-leaf mode ON (topK=${AnvilSecondBot.valueLeafTopK}, blend=${AnvilSecondBot.valueBlend}, veto=${AnvilSecondBot.valueVetoMargin})`);
}

const CHARS = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
const F: Record<string, PlayerFactory> = {
  V1: createTwonky as PlayerFactory,
  Squash: createSquashBot as PlayerFactory,
  Zoom: createZoomBot as PlayerFactory,
  SquashV2: createSquashV2Bot as PlayerFactory,
  SquashV3: createSquashV3Bot as PlayerFactory,
  Hulk: createHulkX90 as PlayerFactory,
  Anvil: createAnvilBot as PlayerFactory,
};

// ── Load evolved policies ──
const EVOLVE_DIR = new URL("./data/anvil_evolve/", import.meta.url).pathname;
const seatFilter = process.env.ANVIL_SEATS?.split(",") ?? ["first", "second"];
const charFilter = process.env.ANVIL_CHARS?.split(",") ?? CHARS;
if (process.env.ANVIL_ZERO === "1") {
  // Explicitly blank BOTH seats — the committed data/anvil_policy.json is
  // non-empty, so merely skipping the evolve-dir load would NOT give Hulk.
  for (const seat of ["first", "second"] as const) {
    for (const c of CHARS) setAnvilPolicy(seat, c, {});
  }
  console.log("ANVIL_ZERO=1 — policies blanked (Anvil ≡ Hulk)");
} else if (process.env.ANVIL_SUFFIX !== undefined) {
  let loaded = 0;
  for (const seat of ["first", "second"] as const) {
    for (const c of CHARS) {
      // ANVIL_SUFFIX picks a specific round's outputs (e.g. "r2"), falling
      // back to the unsuffixed round-1 file when that round is absent.
      const suffix = process.env.ANVIL_SUFFIX;
      const suffixed = suffix ? `${EVOLVE_DIR}${seat}_${c}.${suffix}.json` : "";
      const f = suffixed && existsSync(suffixed) ? suffixed : `${EVOLVE_DIR}${seat}_${c}.json`;
      if (!existsSync(f)) continue;
      const j = JSON.parse(readFileSync(f, "utf8")) as {
        status?: string; accepted?: boolean; deltas?: AnvilDeltas; knobs?: AnvilKnobs;
        best?: AnvilDeltas | { deltas?: AnvilDeltas; knobs?: AnvilKnobs };
      };
      let deltas: AnvilDeltas | undefined;
      let knobs: AnvilKnobs | undefined;
      if (j.status === "done") {
        if (j.accepted) { deltas = j.deltas; knobs = j.knobs; }
      } else if (j.best && typeof j.best === "object" && "deltas" in j.best) {
        deltas = (j.best as { deltas?: AnvilDeltas }).deltas;
        knobs = (j.best as { knobs?: AnvilKnobs }).knobs;
      } else {
        deltas = j.best as AnvilDeltas | undefined;
      }
      const size = Object.keys(deltas ?? {}).length + Object.keys(knobs ?? {}).length;
      if (size > 0 && seatFilter.includes(seat) && charFilter.includes(c)) {
        setAnvilPolicy(seat, c, { deltas, knobs });
        loaded++;
        console.log(`  ${seat}/${c}: ${Object.keys(deltas ?? {}).length} deltas, ${Object.keys(knobs ?? {}).length} knobs (${f.split("/").pop()})`);
      }
    }
  }
  console.log(`Loaded ${loaded} evolved seat/char policies from ${EVOLVE_DIR}`);
} else {
  console.log("Using committed data/anvil_policy.json (shipped Anvil)");
}

// ── CLI ──
const argv = process.argv.slice(2);
const mode = argv[0] as "seat0" | "seat1" | "flip";
const oppName = argv[1] || "Hulk";
const games = parseInt(argv[2] || "50", 10);
const seedOffset = parseInt(argv[3] || "1", 10);
if (!["seat0", "seat1", "flip"].includes(mode) || !F[oppName]) {
  console.error("Usage: anvilBench.ts <seat0|seat1|flip> <opp> [games] [seed]");
  process.exit(1);
}
const fOpp = F[oppName];
const fAnvil = F.Anvil;

let wins = 0, total = 0;
const byChar: Record<string, { w: number; n: number }> = {};
for (const c of CHARS) byChar[c] = { w: 0, n: 0 };

let matchupIdx = 0;
for (const cA of CHARS) {
  for (const cO of CHARS) {
    if (cA === cO) continue;
    for (let i = 0; i < games; i++) {
      const seed = seedOffset + matchupIdx * 1000003 + i;
      const anvilFirst = mode === "seat0" || (mode === "flip" && i % 2 === 0);
      resetCardIds();
      try {
        const game = anvilFirst
          ? new Game({ playerFactories: [fAnvil, fOpp], names: ["Anvil", oppName], chars: [cA, cO], seed })
          : new Game({ playerFactories: [fOpp, fAnvil], names: [oppName, "Anvil"], chars: [cO, cA], seed });
        const winner = game.play();
        total++;
        byChar[cA].n++;
        if (winner.name === "Anvil") { wins++; byChar[cA].w++; }
      } catch (e) {
        console.error(`  Error ${cA} vs ${cO} game ${i}: ${e}`);
      }
    }
    matchupIdx++;
  }
}

const pct = (w: number, n: number) => (n > 0 ? ((w / n) * 100).toFixed(1) : "N/A");
console.log(`\nAnvil [${mode}] vs ${oppName} — ${games}/matchup, seed=${seedOffset}`);
console.log(`ANVIL WINS: ${wins}/${total} (${pct(wins, total)}%)`);
console.log(`  by Anvil char: ` + CHARS.map((c) => `${c} ${pct(byChar[c].w, byChar[c].n)}%`).join(" | "));
