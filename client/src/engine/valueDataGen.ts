/**
 * valueDataGen.ts — generate (state, outcome) training data for the value
 * model. Plays seeded games with a mixed bot pool and captures each player's
 * END-OF-TURN state (post-playTurn: attack applied, damage reset), labeling
 * every row with whether that player ultimately won.
 *
 * Matchup pool is weighted toward the integration target (SquashV3 seat0 vs
 * Anvil seat1) with mirror/cross games for state-space coverage.
 *
 * Run:  npx tsx client/src/engine/valueDataGen.ts <shard> <games> [seedBase=1]
 * Output: client/src/engine/data/value_data/shard_<shard>.csv
 *   lines: gameKey,label,f0,f1,...   (gameKey = held-out splitting by game)
 */

import { createWriteStream, mkdirSync } from "fs";
import { Game, type PlayerFactory } from "./game";
import type { Player } from "./player";
import { resetCardIds } from "./card";
import { createSquashV3Bot } from "./squashV3Bot";
import { createZoomBot } from "./zoomBot";
import { createSquashBot } from "./squashBot";
import { createAnvilBot, AnvilSecondBot } from "./anvilBot";
import { featurize } from "./valueModel";

// DAgger iteration: with ANVIL_VALUE_LEAF=1, the Anvil bots in the pool use
// the CURRENT value-leaf policy, so its own trajectories (including whatever
// blind spots it is exploiting) enter the training distribution with honest
// win/loss labels. Aggregate these shards with the plain ones when training.
if (process.env.ANVIL_VALUE_LEAF === "1") {
  AnvilSecondBot.valueLeafEnabled = true;
  console.log("[dagger] value-leaf ENABLED for pool Anvil bots");
}

const CHARS = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];

const shard = parseInt(process.argv[2] || "0", 10);
const GAMES = parseInt(process.argv[3] || "4000", 10);
const SEED_BASE = parseInt(process.argv[4] || "1", 10);

const OUT_DIR = new URL("./data/value_data/", import.meta.url).pathname;
mkdirSync(OUT_DIR, { recursive: true });
const out = createWriteStream(`${OUT_DIR}shard_${shard}.csv`);

// Matchup pool: [seat0 factory, seat1 factory, tag]. Weighted toward the
// target distribution (V3 first vs Anvil second).
const F = {
  v3: createSquashV3Bot as PlayerFactory,
  zoom: createZoomBot as PlayerFactory,
  squash: createSquashBot as PlayerFactory,
  anvil: createAnvilBot as PlayerFactory,
};
const POOL: [PlayerFactory, PlayerFactory][] = [
  [F.v3, F.anvil],
  [F.v3, F.anvil],
  [F.anvil, F.anvil],
  [F.squash, F.anvil],
  [F.v3, F.zoom],
  [F.anvil, F.squash],
];

/** Wrap a factory to capture the acting player's END-OF-TURN state — after
 * playTurn completes (post-attack, curDamage reset). This matches the
 * evaluation point of the value-leaf rollout in AnvilSecondBot: candidate
 * action → greedy turn completion → assignDamage + attack → featurize.
 * (Under the trained feature mask, cleanUp's hand redraw / token reset are
 * invisible, so the two phase points featurize identically.)
 *
 * One row per player-turn. Mid-turn capture was abandoned: a lookahead
 * maximizing a cross-state model over mid-turn states farms causally-
 * invertible resource features (flare-everything, burn-everything). */
type Row = { seat: number; feats: number[] };

function withCapture(factory: PlayerFactory, rows: Row[]): PlayerFactory {
  return (deck, game, turnOrder, name, character) => {
    const p = factory(deck, game, turnOrder, name, character);
    const origPlayTurn = p.playTurn.bind(p);
    (p as Player).playTurn = (g: Game) => {
      origPlayTurn(g);
      const sim = (p as Player & { _simulating?: boolean })._simulating;
      if (!g.winner && !sim) {
        // Same game moment, both phases: the actor sees "my turn just
        // ended" (postOppTurn=0); the passive player sees "the opponent's
        // reply just resolved" (postOppTurn=1). Matches the two evaluation
        // points of the veto's opp-reply rollout.
        rows.push({ seat: turnOrder, feats: featurize(p, g, 0) });
        const passive = g.players[(turnOrder + 1) % 2];
        rows.push({ seat: passive.turnOrder, feats: featurize(passive, g, 1) });
      }
    };
    return p;
  };
}

let rowsWritten = 0;
let played = 0;
const t0 = Date.now();

for (let i = 0; i < GAMES; i++) {
  const pool = POOL[i % POOL.length];
  const c0 = CHARS[(i * 7 + shard) % 5];
  let c1 = CHARS[(i * 3 + 1 + shard * 2) % 5];
  if (c1 === c0) c1 = CHARS[(CHARS.indexOf(c1) + 1) % 5];
  const seed = SEED_BASE + shard * 50_000_000 + i * 101;
  const rows: Row[] = [];
  resetCardIds();
  try {
    const game = new Game({
      playerFactories: [withCapture(pool[0], rows), withCapture(pool[1], rows)],
      names: ["P0", "P1"],
      chars: [c0, c1],
      seed,
    });
    const winner = game.play();
    if (game.victoryType === "T") continue; // timeout games teach nothing
    const winnerSeat = winner.turnOrder;
    const gameKey = shard * 1_000_000 + i;
    for (const r of rows) {
      const label = r.seat === winnerSeat ? 1 : 0;
      out.write(`${gameKey},${label},${r.feats.map((x) => Math.round(x * 10000) / 10000).join(",")}\n`);
      rowsWritten++;
    }
    played++;
  } catch {
    // skip errored games
  }
  if ((i + 1) % 500 === 0) {
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(`[shard ${shard}] ${i + 1}/${GAMES} games, ${rowsWritten} rows (${mins}m)`);
  }
}

out.end(() => {
  console.log(`[shard ${shard}] DONE: ${played} games, ${rowsWritten} rows -> shard_${shard}.csv`);
});
