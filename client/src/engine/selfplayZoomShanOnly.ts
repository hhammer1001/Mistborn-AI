/**
 * selfplayZoomShanOnly.ts — Targeted training for the worst-performing
 * Zoom configuration: Zoom-Shan as seat 2. Per-matchup analysis showed
 * Zoom-Shan averages 19.9% across opps while other Zoom chars are 37-50%.
 * Hypothesis: Shan-Zoom training data is noise-dominated due to low win
 * rate (~20%) — more games per (opp char) should clean up the lift signal.
 *
 * Trains the Shan slot in each `data/zoom_vs_<oppChar>/Shan.json` file.
 * Other slot files unchanged.
 *
 * Run: npx tsx client/src/engine/selfplayZoomShanOnly.ts [gamesPerOpp]
 */

import { Game, type PlayerFactory } from "./game";
import { createSquashBot } from "./squashBot";
import { createZoomBot, ZoomBot } from "./zoomBot";
import { resetCardIds } from "./card";
import type { Player } from "./player";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";

ZoomBot.seat2Variance = 0;
ZoomBot.lookaheadEnabled = false;

interface CardStat { wins: number; total: number; }

function getOwnedCardNames(player: Player): Set<string> {
  const names = new Set<string>();
  for (const c of player.deck.hand) names.add(c.name);
  for (const c of player.deck.discard) names.add(c.name);
  for (const c of player.deck.cards) names.add(c.name);
  for (const a of player.allies) names.add(a.name);
  return names;
}

function run(gamesPerOpp: number) {
  const opps = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
  console.log(`\n${gamesPerOpp} games per opp char (Zoom-Shan as seat 2 vs Squash-X seat 1)`);
  const start = Date.now();

  for (const opp of opps) {
    const stats: Record<string, CardStat> = {};
    let played = 0;
    for (let i = 0; i < gamesPerOpp; i++) {
      resetCardIds();
      try {
        const game = new Game({
          playerFactories: [createSquashBot as PlayerFactory, createZoomBot as PlayerFactory],
          names: ["Squash", "Zoom"],
          chars: [opp, "Shan"],
        });
        const winner = game.play();
        const zoomWon = winner.name === "Zoom";
        const owned = getOwnedCardNames(game.players[1]);
        for (const name of owned) {
          if (!stats[name]) stats[name] = { wins: 0, total: 0 };
          stats[name].total += 1;
          stats[name].wins += zoomWon ? 1 : -1;
        }
        played++;
      } catch { /* skip */ }
    }
    const out: Record<string, [number, number, number]> = {};
    for (const [name, s] of Object.entries(stats)) {
      const wr = s.total > 0 ? s.wins / s.total : 0;
      out[name] = [s.wins, s.total, wr];
    }
    const oppLower = opp.toLowerCase();
    const dir = `client/src/engine/data/zoom_vs_${oppLower}`;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = `${dir}/Shan.json`;
    writeFileSync(path, JSON.stringify(out, null, 2));
    const wins = Object.values(stats).reduce((s, v) => s + (v.wins > 0 ? 1 : 0), 0);
    console.log(`  Opp=${opp}: ${played} games, ${wins} cards positive, wrote ${path} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  }
}

void readFileSync; // (kept import for potential future merge logic)
const games = parseInt(process.argv[2] || "100000", 10);
run(games);
