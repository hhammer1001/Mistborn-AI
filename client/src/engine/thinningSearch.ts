/**
 * thinningSearch.ts — joint CEM search over the ThinningConfig knobs.
 *
 * Henry's hypothesis: the thinning knobs fail in ISOLATION (fuelGuard paired
 * A/B: 67 win-flips vs 76 loss-flips) but the right JOINT setting could be
 * positive — thinning only pays if bursts/commitment convert the denser
 * draws. Single-knob tests can't see that basin; this searches all 6 dims
 * at once with common random numbers per generation.
 *
 * Run:   npx tsx thinningSearch.ts run              (orchestrator)
 *        npx tsx thinningSearch.ts eval '<json>' <seedBase> <n>   (worker)
 *
 * Fitness: AnvilSecond (live config, veto on) vs SquashV3 seat 0, base-5
 * char rotation. Every candidate in a generation shares the same seed block
 * (CRN); blocks rotate across generations so the mean can't overfit one.
 * Validation vs committed defaults is a separate paired-flip run afterward.
 */
import { spawn } from "child_process";
import { Game, type PlayerFactory } from "./game";
import { resetCardIds } from "./card";
import { createAnvilBot, ThinningConfig } from "./anvilBot";
import { createSquashV3Bot } from "./squashV3Bot";
import { BASE_CHARACTERS } from "./types";

const KEYS = ["effectBoost", "buyBoost", "burstEWeight", "missionRewardScale", "commitScale", "fuelGuard"] as const;
type Genome = Record<(typeof KEYS)[number], number>;
const COMMITTED: Genome = { effectBoost: 8, buyBoost: 2.5, burstEWeight: 2.5, missionRewardScale: 1.5, commitScale: 1.0, fuelGuard: 0 };
const ZERO: Genome = { effectBoost: 0, buyBoost: 0, burstEWeight: 1, missionRewardScale: 0, commitScale: 0, fuelGuard: 0 };
const LO: Genome = { effectBoost: 0, buyBoost: 0, burstEWeight: 1, missionRewardScale: 0, commitScale: 0, fuelGuard: 0 };
const HI: Genome = { effectBoost: 24, buyBoost: 10, burstEWeight: 8, missionRewardScale: 5, commitScale: 4, fuelGuard: 20 };

// ── worker ──
if (process.argv[2] === "eval") {
  const g = JSON.parse(process.argv[3]) as Genome;
  const seedBase = parseInt(process.argv[4], 10);
  const n = parseInt(process.argv[5], 10);
  Object.assign(ThinningConfig, g);
  const CH = [...BASE_CHARACTERS];
  let wins = 0;
  for (let i = 0; i < n; i++) {
    resetCardIds();
    const game = new Game({
      playerFactories: [createSquashV3Bot as PlayerFactory, createAnvilBot as PlayerFactory],
      names: ["V3", "Anvil"],
      chars: [CH[i % 5], CH[(i + 2) % 5]],
      seed: seedBase + i * 53,
    });
    if (game.play().name === "Anvil") wins++;
  }
  console.log(`FIT ${wins / n}`);
  process.exit(0);
}

// ── orchestrator ──
const POP = 14, ELITE = 4, GENS = 7, GAMES = 420, CONC = 6;
// deterministic LCG so the run is reproducible
let rngState = 0xC0FFEE;
function rnd(): number { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 2 ** 32; }
function gauss(): number { return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()); }

function evalGenome(g: Genome, seedBase: number): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn("npx", ["tsx", new URL(import.meta.url).pathname, "eval", JSON.stringify(g), String(seedBase), String(GAMES)], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => {
      const m = out.match(/FIT ([\d.]+)/);
      resolve(m ? parseFloat(m[1]) : NaN);
    });
  });
}

async function pool<T>(tasks: (() => Promise<T>)[], width: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: width }, async () => {
    while (next < tasks.length) { const i = next++; results[i] = await tasks[i](); }
  }));
  return results;
}

const mean: Genome = { effectBoost: 8, buyBoost: 2.5, burstEWeight: 2.5, missionRewardScale: 1.5, commitScale: 1.0, fuelGuard: 5 };
const sigma: Genome = { effectBoost: 5, buyBoost: 2, burstEWeight: 1.5, missionRewardScale: 1.2, commitScale: 1.0, fuelGuard: 5 };

for (let gen = 0; gen < GENS; gen++) {
  const seedBase = 9_100_000_001 + gen * 7_777_777; // CRN within gen, rotate across gens
  const cands: Genome[] = [];
  // anchors: committed defaults + all-zero, every generation, same seeds — free calibration
  cands.push({ ...COMMITTED }, { ...ZERO }, { ...mean });
  while (cands.length < POP) {
    const g = {} as Genome;
    for (const k of KEYS) g[k] = Math.min(HI[k], Math.max(LO[k], mean[k] + sigma[k] * gauss()));
    cands.push(g);
  }
  const fits = await pool(cands.map((g) => () => evalGenome(g, seedBase)), CONC);
  const ranked = cands.map((g, i) => ({ g, f: fits[i] })).sort((a, b) => b.f - a.f);
  const elites = ranked.slice(0, ELITE);
  for (const k of KEYS) {
    const m = elites.reduce((s, e) => s + e.g[k], 0) / ELITE;
    const v = elites.reduce((s, e) => s + (e.g[k] - m) ** 2, 0) / ELITE;
    mean[k] = m;
    sigma[k] = Math.max(0.25, Math.sqrt(v) * 0.9 + sigma[k] * 0.25); // shrink with floor
  }
  const show = (g: Genome) => KEYS.map((k) => `${k.slice(0, 4)}=${g[k].toFixed(1)}`).join(" ");
  console.log(`gen ${gen}: committed=${(fits[0] * 100).toFixed(1)}% zero=${(fits[1] * 100).toFixed(1)}% mean=${(fits[2] * 100).toFixed(1)}% best=${(ranked[0].f * 100).toFixed(1)}% [${show(ranked[0].g)}]`);
  console.log(`   new mean: ${show(mean)}`);
}
console.log("FINAL MEAN", JSON.stringify(mean));
