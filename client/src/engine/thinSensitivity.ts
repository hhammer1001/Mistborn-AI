/** Does the model credit removing a Funding? Mean dP(win) for the same
 * mid-game states with one Funding eliminated (fundingCount -1/6, deckSize
 * -1/20), old weights vs new. argv: <weightsPath> */
import { readFileSync } from "fs";
import { VALUE_FEATURE_NAMES, setValueWeights, winProbFromFeatures, type MlpWeights } from "./valueModel";
const w = JSON.parse(readFileSync(process.argv[2], "utf8")) as { weights?: number[] | null; mlp?: MlpWeights | null };
setValueWeights(w.weights ?? null, w.mlp ?? null);
const FI_TURN = VALUE_FEATURE_NAMES.indexOf("turnCount");
const FI_FUND = VALUE_FEATURE_NAMES.indexOf("fundingCount");
const FI_DECK = VALUE_FEATURE_NAMES.indexOf("deckSize");
const rows: number[][] = [];
const dir = new URL("./data/value_data/", import.meta.url).pathname;
for (const shard of ["shard_0.csv", "shard_3.csv"]) {
  for (const line of readFileSync(dir + shard, "utf8").split("\n")) {
    if (rows.length >= 4000) break;
    const p = line.split(",");
    if (p.length < 5) continue;
    const f = p.slice(2).map(Number);
    if (f[FI_TURN] >= 0.2 && f[FI_TURN] <= 0.5 && f[FI_FUND] >= 2 / 6) rows.push(f);
  }
}
let d = 0;
for (const f of rows) {
  const base = winProbFromFeatures(f);
  const g = [...f];
  g[FI_FUND] -= 1 / 6;
  g[FI_DECK] -= 1 / 20;
  d += winProbFromFeatures(g) - base;
}
console.log(`${process.argv[2].split("/").pop()}: mean dP(win) from eliminating one Funding = ${(100 * d / rows.length).toFixed(3)}pp over ${rows.length} mid-game states`);
