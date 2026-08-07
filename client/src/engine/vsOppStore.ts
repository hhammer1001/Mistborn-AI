/** Read/write helper for the consolidated per-opponent lift tables.
 *
 *  Both families live in a single file keyed oppChar → botChar → cardName →
 *  [wins, total, winRate]:
 *      data/zoom_vs_opp.json        (Zoom seat 1, recorded vs a seat-0 opponent)
 *      data/squashV2_vs_opp.json    (SquashV2 seat 0, recorded vs a seat-1 Zoom)
 *
 *  Generators merge their slice in rather than rewriting the file, so training
 *  one (opp, bot) pair never disturbs pairs trained in an earlier run. That
 *  matters because the full matrix is far too expensive to regenerate in one go.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";

export type WeightData = Record<string, [number, number, number]>;
export type VsOppTable = Record<string, Record<string, WeightData>>;

const PATHS = {
  zoom: "client/src/engine/data/zoom_vs_opp.json",
  squashV2: "client/src/engine/data/squashV2_vs_opp.json",
} as const;

export type VsOppFamily = keyof typeof PATHS;

export function loadVsOpp(family: VsOppFamily): VsOppTable {
  const path = PATHS[family];
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as VsOppTable;
}

/** Merge `slice` (oppChar → botChar → weights) into the family's table. Only
 *  the (opp, bot) pairs present in `slice` are replaced. */
export function mergeVsOpp(family: VsOppFamily, slice: VsOppTable): void {
  const table = loadVsOpp(family);
  let pairs = 0;
  for (const [opp, byBot] of Object.entries(slice)) {
    table[opp] ??= {};
    for (const [bot, weights] of Object.entries(byBot)) {
      table[opp][bot] = weights;
      pairs++;
    }
  }
  // Sort keys so re-runs produce minimal diffs.
  const sorted: VsOppTable = {};
  for (const opp of Object.keys(table).sort()) {
    sorted[opp] = {};
    for (const bot of Object.keys(table[opp]).sort()) sorted[opp][bot] = table[opp][bot];
  }
  writeFileSync(PATHS[family], JSON.stringify(sorted));
  console.log(`  merged ${pairs} (opp,bot) pair(s) into ${PATHS[family]}`);
}
