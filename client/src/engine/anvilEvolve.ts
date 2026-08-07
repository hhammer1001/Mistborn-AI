/**
 * anvilEvolve.ts — evolution-strategy trainer for Anvil policies (v2: league
 * fitness + successive-halving evaluation + double validation gate).
 *
 * Evolves, for ONE character in ONE seat, a genome with two gene families:
 *   deltas — per-card rating deltas (65 distinct market card names)
 *   knobs  — heuristic-assumption + lookahead-shape scalars (ANVIL_KNOB_DEFS)
 *
 * LEAGUE FITNESS: each candidate plays a mixed pool of frozen opponents in
 * the opposite seat — the committed Anvil itself (policy seats don't collide:
 * a seat-0 candidate only writes policy.first[char]; the opponent reads
 * policy.second[*]), the Hulk specialist (Zoom / SquashV3), and Squash as a
 * generalization anchor. Robust gains survive the mix; single-opponent
 * exploits don't.
 *
 * SUCCESSIVE HALVING: every candidate plays stage 1; the top half plays
 * stage 2; the top quarter plays stage 3 (finalists see 4x stage-1 games).
 * Concentrates games on contenders — selection noise was the binding
 * constraint of the first campaign (sigma ~3.5pp at 160-game evals).
 *
 * DOUBLE VALIDATION GATE: after the last generation, elites + the zero
 * genome are evaluated on TWO disjoint held-out blocks. A genome ships only
 * if it beats zero pooled AND is not materially negative on either block —
 * automates the cross-range replication that killed half of the previous
 * campaign's val-accepted policies.
 *
 * Methodology carried over: common random numbers within a generation,
 * fresh seeds every generation (elites re-evaluated), zero genome kept in
 * the initial population.
 *
 * Run:  npx tsx client/src/engine/anvilEvolve.ts <first|second> <Character>
 *         [gens=20] [pop=24] [stage1GamesPerOpp=10] [seedBase=1] [initFile] [outSuffix]
 * Env:  KNOBS=1   — also mutate heuristic/lookahead knobs
 *       DELTAS=0  — freeze card deltas (knob-only search)
 * Output: client/src/engine/data/anvil_evolve/<seat>_<Character>[.<suffix>].json
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { Game, type PlayerFactory } from "./game";
import { resetCardIds } from "./card";
import { createSquashV3Bot } from "./squashV3Bot";
import { createZoomBot } from "./zoomBot";
import { createSquashBot } from "./squashBot";
import { createAnvilBot, setAnvilPolicy, ANVIL_KNOB_DEFS, type AnvilDeltas, type AnvilKnobs } from "./anvilBot";
import { MARKET_DECK } from "./data/marketDeck";
import { CHARACTERS, BASE_CHARACTERS } from "./types";

// Opponent pool stays the five characters with trained weight tables — they
// are the meaningful benchmark, and holding the pool fixed keeps fitness
// comparable across campaigns. Any character on the full roster may be the
// one being trained.
const CHARS = [...BASE_CHARACTERS];
const CARD_NAMES = [...new Set(MARKET_DECK.map((c) => c.name))];
const KNOB_KEYS = Object.keys(ANVIL_KNOB_DEFS);
// Base-bot values for look* knobs; add-knobs default 0, mult-knobs default 1.
const KNOB_DEFAULTS: Record<string, number> = {
  lookTopK: 2, lookFollowupWeight: 0.6, lookDepth: 1, lookLethalThreshold: 14, lookGapGate: 0,
};
function knobDefault(key: string): number {
  return KNOB_DEFAULTS[key] ?? (ANVIL_KNOB_DEFS[key].mult ? 1 : 0);
}

// ── CLI ──
const argv = process.argv.slice(2);
const seat = argv[0] as "first" | "second";
const character = argv[1];
const GENS = parseInt(argv[2] || "20", 10);
const POP = parseInt(argv[3] || "24", 10);
const STAGE1_PER_OPP = parseInt(argv[4] || "10", 10);
const SEED_BASE = parseInt(argv[5] || "1", 10);
const EVOLVE_KNOBS = process.env.KNOBS === "1";
const EVOLVE_DELTAS = process.env.DELTAS !== "0";
if ((seat !== "first" && seat !== "second") || !(CHARACTERS as readonly string[]).includes(character)) {
  console.error("Usage: anvilEvolve.ts <first|second> <Character> [gens] [pop] [stage1GamesPerOpp] [seedBase] [initFile] [outSuffix]");
  process.exit(1);
}
const OPP_CHARS = CHARS.filter((c) => c !== character);
const ELITES = 4;
const OUT_DIR = new URL("./data/anvil_evolve/", import.meta.url).pathname;
mkdirSync(OUT_DIR, { recursive: true });
const OUT_FILE = `${OUT_DIR}${seat}_${character}${argv[7] ? `.${argv[7]}` : ""}.json`;

// ── League opponent pool ──
// Candidate seat0 → opponents in seat1; candidate seat1 → opponents in seat0.
// createAnvilBot reads the committed policy for the OPPOSITE seat — the
// candidate only mutates its own (seat, char) slot, so the league Anvil
// stays frozen for the whole run.
const anvilFactory = createAnvilBot as PlayerFactory;
const OPP_POOL: { kind: string; factory: PlayerFactory }[] = seat === "first"
  ? [
      { kind: "anvil", factory: anvilFactory },
      { kind: "zoom", factory: createZoomBot as PlayerFactory },
      { kind: "squash", factory: createSquashBot as PlayerFactory },
    ]
  : [
      { kind: "anvil", factory: anvilFactory },
      { kind: "v3", factory: createSquashV3Bot as PlayerFactory },
      { kind: "squash", factory: createSquashBot as PlayerFactory },
    ];

// ── Genome ops ──

interface Genome {
  deltas: AnvilDeltas;
  knobs: AnvilKnobs;
}

function zeroGenome(): Genome {
  return { deltas: {}, knobs: {} };
}

function gauss(): number {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** sigmaScale anneals 1.0 → 0.5 across the run: explore early, refine late. */
function mutate(g: Genome, sigmaScale: number): Genome {
  const deltas: AnvilDeltas = { ...g.deltas };
  if (EVOLVE_DELTAS) {
    for (const name of CARD_NAMES) {
      const r = Math.random();
      if (r < 0.2) {
        deltas[name] = (deltas[name] ?? 0) + gauss() * 2.0 * sigmaScale;
      } else if (r < 0.24) {
        // occasional big jump — lets buried cards cross the buy buffer outright
        deltas[name] = (deltas[name] ?? 0) + (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 6) * sigmaScale;
      } else if (r < 0.3) {
        delete deltas[name]; // sparsity pressure — prefer minimal policies
      }
    }
    for (const name of Object.keys(deltas)) {
      deltas[name] = Math.max(-25, Math.min(25, deltas[name]));
      if (Math.abs(deltas[name]) < 0.05) delete deltas[name];
    }
  }

  const knobs: AnvilKnobs = { ...g.knobs };
  if (EVOLVE_KNOBS) {
    for (const key of KNOB_KEYS) {
      const def = ANVIL_KNOB_DEFS[key];
      const r = Math.random();
      if (r < 0.25) {
        let v = (knobs[key] ?? knobDefault(key)) + gauss() * def.sigma * sigmaScale;
        v = Math.max(def.min, Math.min(def.max, v));
        if (def.int) v = Math.round(v);
        knobs[key] = v;
      } else if (r < 0.3) {
        delete knobs[key]; // revert to base behavior
      }
    }
    for (const key of Object.keys(knobs)) {
      if (Math.abs(knobs[key] - knobDefault(key)) < 1e-9) delete knobs[key];
    }
  }
  return { deltas, knobs };
}

function crossover(a: Genome, b: Genome): Genome {
  const deltas: AnvilDeltas = {};
  for (const name of new Set([...Object.keys(a.deltas), ...Object.keys(b.deltas)])) {
    const v = Math.random() < 0.5 ? a.deltas[name] : b.deltas[name];
    if (v !== undefined) deltas[name] = v;
  }
  const knobs: AnvilKnobs = {};
  for (const key of new Set([...Object.keys(a.knobs), ...Object.keys(b.knobs)])) {
    const v = Math.random() < 0.5 ? a.knobs[key] : b.knobs[key];
    if (v !== undefined) knobs[key] = v;
  }
  return { deltas, knobs };
}

// ── Fitness ──

/** Play one block of games for a genome: gamesPerOpp against each
 * (opponentKind x opponentChar) pair on deterministic seeds. Returns
 * {wins, total}. Seeds depend only on (seedBlock, kind, oppChar, i) so all
 * candidates share games within a generation stage. */
function playBlock(genome: Genome, seedBlock: number, gamesPerOpp: number): { wins: number; total: number } {
  setAnvilPolicy(seat, character, genome);
  let wins = 0;
  let total = 0;
  for (let k = 0; k < OPP_POOL.length; k++) {
    const pool = OPP_POOL[k];
    for (let oppIdx = 0; oppIdx < OPP_CHARS.length; oppIdx++) {
      const opp = OPP_CHARS[oppIdx];
      for (let i = 0; i < gamesPerOpp; i++) {
        const seed = seedBlock + k * 37_337_999 + oppIdx * 1_000_003 + i;
        resetCardIds();
        try {
          const game = seat === "first"
            ? new Game({
                playerFactories: [anvilFactory, pool.factory],
                names: ["Anvil", "Opp"],
                chars: [character, opp],
                seed,
              })
            : new Game({
                playerFactories: [pool.factory, anvilFactory],
                names: ["Opp", "Anvil"],
                chars: [opp, character],
                seed,
              });
          const winner = game.play();
          total++;
          if (winner.name === "Anvil") wins++;
        } catch {
          // count errored games as losses so crashy policies are selected against
          total++;
        }
      }
    }
  }
  return { wins, total };
}

interface Scored {
  genome: Genome;
  wins: number;
  total: number;
  fitness: number;
}

/** Successive-halving evaluation: all candidates play stage 1, top half adds
 * stage 2, top quarter adds stage 3 (2x stage size). Ranking is by pooled
 * win rate over all games a candidate has played this generation. */
function evaluateRace(genomes: Genome[], seedBlock: number): Scored[] {
  const scored: Scored[] = genomes.map((genome) => ({ genome, wins: 0, total: 0, fitness: 0 }));
  const stages = [
    { games: STAGE1_PER_OPP, survivors: scored.length },
    { games: STAGE1_PER_OPP, survivors: Math.ceil(scored.length / 2) },
    { games: STAGE1_PER_OPP * 2, survivors: Math.ceil(scored.length / 4) },
  ];
  let active = [...scored];
  let stageSeed = seedBlock;
  for (const stage of stages) {
    active = active.slice(0, stage.survivors);
    for (const s of active) {
      const r = playBlock(s.genome, stageSeed, stage.games);
      s.wins += r.wins;
      s.total += r.total;
      s.fitness = s.total > 0 ? s.wins / s.total : 0;
    }
    active.sort((a, b) => b.fitness - a.fitness);
    stageSeed += 611_953; // next stage plays different games
  }
  scored.sort((a, b) => b.fitness - a.fitness);
  return scored;
}

// ── Main loop ──

let initGenome: Genome = zeroGenome();
const initFile = argv[6];
if (initFile && existsSync(initFile)) {
  const j = JSON.parse(readFileSync(initFile, "utf8")) as {
    deltas?: AnvilDeltas; best?: AnvilDeltas | Genome; knobs?: AnvilKnobs;
  };
  // Accept both old checkpoints ({best: deltas} / {deltas}) and new ({deltas, knobs}).
  const rawBest = j.best as AnvilDeltas | Genome | undefined;
  if (rawBest && typeof rawBest === "object" && "deltas" in rawBest) {
    initGenome = { deltas: (rawBest as Genome).deltas ?? {}, knobs: (rawBest as Genome).knobs ?? {} };
  } else {
    initGenome = { deltas: j.deltas ?? (rawBest as AnvilDeltas) ?? {}, knobs: j.knobs ?? {} };
  }
  console.log(`[${seat}/${character}] init from ${initFile} (${Object.keys(initGenome.deltas).length} deltas, ${Object.keys(initGenome.knobs).length} knobs)`);
}
console.log(`[${seat}/${character}] league pool: ${OPP_POOL.map((p) => p.kind).join("+")} | knobs=${EVOLVE_KNOBS} deltas=${EVOLVE_DELTAS} pop=${POP} gens=${GENS} stage1/opp=${STAGE1_PER_OPP}`);

// Zero stays in the initial population even when continuing from a checkpoint,
// so a bad checkpoint can be selected away immediately.
let population: Genome[] = [initGenome, zeroGenome()];
while (population.length < POP) population.push(mutate(initGenome, 1.0));

let lastElites: Scored[] = [];
const t0 = Date.now();

for (let gen = 0; gen < GENS; gen++) {
  const seedBlock = SEED_BASE + gen * 7_777_777;
  const scored = evaluateRace(population, seedBlock);
  lastElites = scored.slice(0, ELITES);

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  const b = lastElites[0];
  console.log(
    `[${seat}/${character}] gen ${gen}: best=${(b.fitness * 100).toFixed(1)}% (${b.wins}/${b.total}) ` +
    `genes=${Object.keys(b.genome.deltas).length}+${Object.keys(b.genome.knobs).length}k (${mins}m)`,
  );

  // Crash-safe checkpoint of the current best.
  writeFileSync(OUT_FILE, JSON.stringify({
    seat, character, status: "running", gen,
    best: b.genome, bestFitness: b.fitness,
  }, null, 2));

  // Next generation: elites survive, offspring from mutation + crossover.
  const sigmaScale = 1.0 - 0.5 * (gen / Math.max(1, GENS - 1));
  const next: Genome[] = lastElites.map((e) => e.genome);
  while (next.length < POP) {
    const a = lastElites[Math.floor(Math.random() * ELITES)].genome;
    if (Math.random() < 0.3 && ELITES >= 2) {
      const c = lastElites[Math.floor(Math.random() * ELITES)].genome;
      next.push(mutate(crossover(a, c), sigmaScale));
    } else {
      next.push(mutate(a, sigmaScale));
    }
  }
  population = next;
}

// ── Double validation gate on two disjoint held-out blocks ──
// A genome ships only if it beats zero POOLED across both blocks AND is not
// materially negative on either block alone. This automates the cross-range
// replication step that killed half of the previous campaign's policies.
const VAL_PER_OPP = STAGE1_PER_OPP * 3;
const VAL_BLOCKS = [SEED_BASE + 500_000_009, SEED_BASE + 611_000_027];
console.log(`[${seat}/${character}] double-gate: ${ELITES} elites + zero on 2 x ${VAL_PER_OPP * OPP_CHARS.length * OPP_POOL.length} held-out games...`);

function valPair(genome: Genome): { pooled: number; blocks: number[] } {
  const blocks = VAL_BLOCKS.map((sb) => {
    const r = playBlock(genome, sb, VAL_PER_OPP);
    return r.wins / Math.max(1, r.total);
  });
  return { pooled: (blocks[0] + blocks[1]) / 2, blocks };
}

const zeroV = valPair(zeroGenome());
let bestGenome: Genome = zeroGenome();
let bestPooled = zeroV.pooled;
let bestBlocks = zeroV.blocks;
for (const e of lastElites) {
  const v = valPair(e.genome);
  const passes = v.pooled > zeroV.pooled &&
    v.blocks[0] >= zeroV.blocks[0] - 0.005 &&
    v.blocks[1] >= zeroV.blocks[1] - 0.005;
  console.log(
    `  elite (genes=${Object.keys(e.genome.deltas).length}+${Object.keys(e.genome.knobs).length}k, trainFit=${(e.fitness * 100).toFixed(1)}%): ` +
    `valA=${(v.blocks[0] * 100).toFixed(1)}% valB=${(v.blocks[1] * 100).toFixed(1)}% pooled=${(v.pooled * 100).toFixed(1)}% ${passes ? "PASS" : "fail"}`,
  );
  if (passes && v.pooled > bestPooled) {
    bestPooled = v.pooled;
    bestBlocks = v.blocks;
    bestGenome = e.genome;
  }
}
console.log(`  zero baseline: valA=${(zeroV.blocks[0] * 100).toFixed(1)}% valB=${(zeroV.blocks[1] * 100).toFixed(1)}% pooled=${(zeroV.pooled * 100).toFixed(1)}%`);

const accepted = Object.keys(bestGenome.deltas).length + Object.keys(bestGenome.knobs).length > 0;
writeFileSync(OUT_FILE, JSON.stringify({
  seat, character, status: "done",
  accepted,
  deltas: bestGenome.deltas,
  knobs: bestGenome.knobs,
  valWinRate: bestPooled,
  valBlocks: bestBlocks,
  zeroWinRate: zeroV.pooled,
  liftPp: (bestPooled - zeroV.pooled) * 100,
}, null, 2));
console.log(
  `[${seat}/${character}] DONE: ${accepted ? "ACCEPTED" : "rejected (zero wins or gate failed)"} ` +
  `pooled=${(bestPooled * 100).toFixed(1)}% vs zero=${(zeroV.pooled * 100).toFixed(1)}% (+${((bestPooled - zeroV.pooled) * 100).toFixed(1)}pp) -> ${OUT_FILE}`,
);
