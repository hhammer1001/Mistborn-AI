/** Paired-flip validation: candidate ThinningConfig vs committed defaults,
 * fresh seed ranges. argv: <shard 0-5> <candidateJson> */
import { Game, type PlayerFactory } from "./game";
import { resetCardIds } from "./card";
import { createAnvilBot, ThinningConfig } from "./anvilBot";
import { createSquashV3Bot } from "./squashV3Bot";
import { BASE_CHARACTERS } from "./types";
const CH = [...BASE_CHARACTERS];
const shard = parseInt(process.argv[2], 10);
const CAND = JSON.parse(process.argv[3]) as Record<string, number>;
const BASE = { effectBoost: 8, buyBoost: 2.5, burstEWeight: 2.5, missionRewardScale: 1.5, commitScale: 1.0, fuelGuard: 0 };
const RANGES = process.env.THIN_RANGES ? process.env.THIN_RANGES.split(",").map(Number) : [7900000001, 8300000001];
const N = 350;
function play(seed: number, i: number, cfg: Record<string, number>): boolean {
  Object.assign(ThinningConfig, cfg);
  resetCardIds();
  const g = new Game({ playerFactories: [createSquashV3Bot as PlayerFactory, createAnvilBot as PlayerFactory], names: ["V3", "Anvil"], chars: [CH[i % 5], CH[(i + 2) % 5]], seed });
  return g.play().name === "Anvil";
}
let toWin = 0, toLoss = 0, winsB = 0, winsC = 0, n = 0;
for (const base of RANGES) {
  for (let i = 0; i < N; i++) {
    const idx = shard * N + i;
    const seed = base + idx * 53;
    const a = play(seed, idx, BASE);
    const b = play(seed, idx, CAND);
    winsB += a ? 1 : 0; winsC += b ? 1 : 0; n++;
    if (a !== b) { if (b) toWin++; else toLoss++; }
  }
}
console.log(JSON.stringify({ shard, toWin, toLoss, winsB, winsC, n }));
