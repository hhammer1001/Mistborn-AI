/**
 * selfplayZoomVsShan.ts — Targeted asymmetric training: Zoom seat 2 vs a
 * fixed Squash-character seat 1, recording only Zoom outcomes. Generates a
 * separate weight set used CONDITIONALLY at runtime — only when opp matches.
 *
 * Why per-opp: certain matchups (especially opp-Shan-1st) leave Zoom at 10-22%
 * win rate. General heuristics can't fix it; targeted data can specialize.
 * Survivorship bias is concentrated to this single matchup, mitigated by:
 *   - Per-Zoom-character normalization (bigger sample per char)
 *   - Baseline normalization in dynamicCardRating
 *   - Only applied conditionally — doesn't pollute non-matching matchups
 *
 * Run: npx tsx client/src/engine/selfplayZoomVsShan.ts [gamesPerChar] [oppChar]
 * Output: client/src/engine/data/zoom_vs_<oppChar>/{char}.json
 */

import { Game, type PlayerFactory } from "./game";
import { createSquashBot } from "./squashBot";
import { createZoomBot, ZoomBot } from "./zoomBot";
import { resetCardIds } from "./card";
import type { Player } from "./player";
import { writeFileSync, mkdirSync, existsSync } from "fs";

ZoomBot.seat2Variance = 0;
ZoomBot.lookaheadEnabled = false;

interface CardStat { wins: number; total: number; }
type WeightData = Record<string, [number, number, number]>;

function getOwnedCardNames(player: Player): Set<string> {
  const names = new Set<string>();
  for (const c of player.deck.hand) names.add(c.name);
  for (const c of player.deck.discard) names.add(c.name);
  for (const c of player.deck.cards) names.add(c.name);
  for (const a of player.allies) names.add(a.name);
  return names;
}

function run(gamesPerChar: number, oppChar: string, outputDir: string) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
  const stats: Record<string, Record<string, CardStat>> = {};
  for (const c of chars) stats[c] = {};

  console.log(`\n${gamesPerChar} games/char: Zoom-{X} seat 2 vs ${oppChar}-Squash seat 1.`);
  const start = Date.now();
  let played = 0;

  for (const zoomChar of chars) {
    for (let i = 0; i < gamesPerChar; i++) {
      resetCardIds();
      try {
        const game = new Game({
          playerFactories: [createSquashBot as PlayerFactory, createZoomBot as PlayerFactory],
          names: ["Squash", "Zoom"],
          chars: [oppChar, zoomChar],
        });
        const winner = game.play();
        const zoomWon = winner.name === "Zoom";
        const owned = getOwnedCardNames(game.players[1]);
        for (const name of owned) {
          if (!stats[zoomChar][name]) stats[zoomChar][name] = { wins: 0, total: 0 };
          stats[zoomChar][name].total += 1;
          stats[zoomChar][name].wins += zoomWon ? 1 : -1;
        }
        played++;
      } catch { /* skip crashes */ }
    }
    console.log(`  ${zoomChar}: done (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  }

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  for (const char of chars) {
    const out: WeightData = {};
    for (const [name, s] of Object.entries(stats[char])) {
      const wr = s.total > 0 ? s.wins / s.total : 0;
      out[name] = [s.wins, s.total, wr];
    }
    writeFileSync(`${outputDir}/${char}.json`, JSON.stringify(out, null, 2));
  }
  console.log(`\n${played} games. Files in ${outputDir}.`);
}

const games = parseInt(process.argv[2] || "20000", 10);
const oppChar = process.argv[3] || "Shan";
const dir = process.argv[4] || `client/src/engine/data/zoom_vs_${oppChar.toLowerCase()}`;
run(games, oppChar, dir);
