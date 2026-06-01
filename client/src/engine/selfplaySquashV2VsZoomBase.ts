/**
 * selfplaySquashV2VsZoomBase.ts — re-derive SquashV2 going-FIRST base weights
 * against a STRONGER seat-1 opponent (Zoom, the going-second specialist) instead
 * of the V2 mirror. Motivation: the human (Henry) goes SECOND, so the seat-0 bot
 * should be trained against the strongest going-second player we have, not
 * against V2-in-seat-1 (a going-first specialist playing out of position).
 *
 * Seat 0 = SquashV2 (recorded). Seat 1 = Zoom (random character). Records seat-0
 * card ownership outcomes, same format as selfplaySquashV2.ts.
 *
 * Output: client/src/engine/data/squashV2_weights_vsZoom/<Character>.json
 * Run: npx tsx client/src/engine/selfplaySquashV2VsZoomBase.ts [gamesPerChar]
 *
 * Bootstraps with blend=0 (train against analytical-only ratings — no feedback).
 */

import { Game, type PlayerFactory } from "./game";
import { createSquashV2Bot, SquashV2Bot } from "./squashV2Bot";
import { createZoomBot } from "./zoomBot";
import { resetCardIds } from "./card";
import type { Player } from "./player";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { SquashV2Config, recomputeSquashV2Ratings } from "./squashBotEval";

SquashV2Bot.lookaheadEnabled = false; // heuristic-only training signal
SquashV2Config.selfPlayBlend = 0; // bootstrap: analytical-only, no feedback
recomputeSquashV2Ratings();

type WeightData = Record<string, [number, number, number]>;

function getOwnedCardNames(player: Player): Set<string> {
  const names = new Set<string>();
  for (const c of player.deck.hand) names.add(c.name);
  for (const c of player.deck.discard) names.add(c.name);
  for (const c of player.deck.cards) names.add(c.name);
  for (const a of player.allies) names.add(a.name);
  return names;
}

function run(gamesPerChar: number, outputDir: string) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
  const stats: Record<string, Record<string, { wins: number; total: number }>> = {};
  for (const c of chars) stats[c] = {};

  console.log(`\nSquashV2 (seat0) vs ZOOM (seat1) — ${gamesPerChar} games/char, recording seat-0.\n`);
  const start = Date.now();
  let played = 0;

  for (const char of chars) {
    for (let i = 0; i < gamesPerChar; i++) {
      const seat1Char = chars[Math.floor((i * 7 + 3) % chars.length)]; // deterministic spread
      resetCardIds();
      try {
        const game = new Game({
          playerFactories: [createSquashV2Bot as PlayerFactory, createZoomBot as PlayerFactory],
          names: ["P0", "P1"],
          chars: [char, seat1Char],
        });
        const winner = game.play();
        const won = winner.name === "P0";
        for (const cardName of getOwnedCardNames(game.players[0])) {
          if (!stats[char][cardName]) stats[char][cardName] = { wins: 0, total: 0 };
          stats[char][cardName].total += 1;
          stats[char][cardName].wins += won ? 1 : -1;
        }
        played++;
      } catch {
        /* skip crashes */
      }
    }
    console.log(`  ${char}: done (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  }

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  for (const char of chars) {
    const weights: WeightData = {};
    for (const [name, s] of Object.entries(stats[char])) {
      weights[name] = [s.wins, s.total, s.total > 0 ? s.wins / s.total : 0];
    }
    writeFileSync(`${outputDir}/${char}.json`, JSON.stringify(weights, null, 2));
    console.log(`  Wrote ${outputDir}/${char}.json (${Object.keys(weights).length} cards)`);
  }
  console.log(`\nTotal ${played} games in ${((Date.now() - start) / 1000).toFixed(1)}s`);
}

const gamesPerChar = parseInt(process.argv[2] || "1000", 10);
const outputDir = process.argv[3] || "client/src/engine/data/squashV2_weights_vsZoom";
run(gamesPerChar, outputDir);
