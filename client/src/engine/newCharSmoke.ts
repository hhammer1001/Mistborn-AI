/** Smoke test: play the expansion characters against the trained field with
 *  Anvil on both sides. Verifies the new abilities resolve without throwing
 *  and reports a rough pre-training baseline. */

import { Game } from "./game";
import { resetCardIds } from "./card";
import { createAnvilBot } from "./anvilBot";
import { starterDeckGroup } from "./deck";
import { CHARACTER_DEFS } from "./data/characters";
import { CHARACTERS, BASE_CHARACTERS, EXPANSION_CHARACTERS } from "./types";

const NEW = EXPANSION_CHARACTERS;
const GAMES = 12;

for (const c of CHARACTERS) {
  const d = CHARACTER_DEFS[c];
  console.log(`${c.padEnd(8)} metal=${d.ability1Metal} I=${d.ability1Effect}/${d.ability1Amount}  III=${d.ability3Effect}/${d.ability3Amount}  deck=${starterDeckGroup(c)}`);
}

let total = 0, errs = 0;
const tally: Record<string, { w: number; n: number }> = {};
for (const nc of NEW) {
  tally[nc] = { w: 0, n: 0 };
  for (const oc of BASE_CHARACTERS) {
    for (let s = 0; s < GAMES; s++) {
      resetCardIds();
      try {
        // New char in seat 1 (going second) — the seat Henry plays.
        const game = new Game({
          playerFactories: [createAnvilBot, createAnvilBot],
          names: ["Field", "New"], chars: [oc, nc], seed: 5000 + s,
        });
        const winner = game.play();
        total++;
        tally[nc].n++;
        if (winner.name === "New") tally[nc].w++;
      } catch (e) {
        errs++;
        if (errs <= 5) console.error(`ERR ${nc} vs ${oc} seed ${s}: ${(e as Error).message}`);
      }
    }
  }
}

console.log(`\n${total} games, ${errs} errors`);
for (const [c, t] of Object.entries(tally)) {
  console.log(`${c.padEnd(8)} seat-1 winrate vs field: ${(100 * t.w / t.n).toFixed(1)}%  (n=${t.n})`);
}
