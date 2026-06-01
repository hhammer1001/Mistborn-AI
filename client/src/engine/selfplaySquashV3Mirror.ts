/**
 * selfplaySquashV3Mirror.ts — full-scale base-weight retrain using the SHIPPING
 * V3 bot (nopen + card-play tweaks) in both seats. Mirror, seat-0-recorded,
 * blend=0 bootstrap (analytical-only ratings during data generation). Same
 * methodology as the committed selfplaySquashV2.ts mirror, but with the V3 bot
 * so the resulting weights reflect how V3 actually plays.
 *
 * Output: client/src/engine/data/squashV3_weights/<Character>.json
 * Run: npx tsx client/src/engine/selfplaySquashV3Mirror.ts [gamesPerChar=50000] [outDir]
 */
import { Game, type PlayerFactory } from "./game";
import { createSquashV3Bot } from "./squashV3Bot";
import { SquashV2Bot } from "./squashV2Bot";
import { resetCardIds } from "./card";
import type { Player } from "./player";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { SquashV2Config, recomputeSquashV2Ratings } from "./squashBotEval";

SquashV2Bot.lookaheadEnabled = false; // heuristic-only training signal (inherited by V3)
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

  console.log(`\nSquashV3 mirror — ${gamesPerChar} games/char, recording seat-0.\n`);
  const start = Date.now();
  let played = 0;

  for (const char of chars) {
    const cstart = Date.now();
    for (let i = 0; i < gamesPerChar; i++) {
      const seat1Char = chars[(i * 7 + 3) % chars.length]; // deterministic spread
      resetCardIds();
      try {
        const game = new Game({
          playerFactories: [createSquashV3Bot as PlayerFactory, createSquashV3Bot as PlayerFactory],
          names: ["P0", "P1"],
          chars: [char, seat1Char],
        });
        const won = game.play().name === "P0";
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
    console.log(`  ${char}: ${gamesPerChar} done (${((Date.now() - cstart) / 1000).toFixed(0)}s, ${((Date.now() - start) / 1000).toFixed(0)}s total)`);
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
  console.log(`\nTotal ${played} games in ${((Date.now() - start) / 1000).toFixed(0)}s`);
}

const gamesPerChar = parseInt(process.argv[2] || "50000", 10);
const outputDir = process.argv[3] || "client/src/engine/data/squashV3_weights";
run(gamesPerChar, outputDir);
