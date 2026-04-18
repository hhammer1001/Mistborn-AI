/**
 * selfplay.ts — Collect Squash-vs-Squash mirror-matchup data to generate
 * character-specific card weights. Mirror matchups (same char both sides)
 * eliminate character-vs-character variance, so card-level differences are the
 * only signal.
 *
 * We track BOTH players in each game, since both are playing the same character.
 *
 * Run with: npx tsx client/src/engine/selfplay.ts [gamesPerChar]
 * Output: client/src/engine/data/squash_weights/<Character>.json
 *
 * Output format (matches existing Kelsier3.json style):
 *   { "CardName": [wins_delta, total_games, winRate], ... }
 * where winRate = (wins - losses) / total_games, normalized against the
 * character's self-play baseline (starter cards' average).
 */

import { Game, type PlayerFactory } from "./game";
import { createSquashBot, SquashBot } from "./squashBot";
import { resetCardIds } from "./card";
import type { Player } from "./player";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

interface CardStat {
  wins: number; // net: +1 if had card and won, -1 if had card and lost
  total: number;
}

type WeightData = Record<string, [number, number, number]>;

function getOwnedCardNames(player: Player): Set<string> {
  const names = new Set<string>();
  for (const c of player.deck.hand) names.add(c.name);
  for (const c of player.deck.discard) names.add(c.name);
  for (const c of player.deck.cards) names.add(c.name);
  for (const a of player.allies) names.add(a.name);
  return names;
}

function runSelfPlay(gamesPerChar: number, outputDir: string) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];

  const stats: Record<string, Record<string, CardStat>> = {};
  for (const c of chars) stats[c] = {};

  console.log(`\nRunning ${gamesPerChar} mirror games per character (${gamesPerChar * chars.length} total Squash-vs-Squash games)\n`);

  const startTime = Date.now();
  let gamesPlayed = 0;

  for (const char of chars) {
    for (let i = 0; i < gamesPerChar; i++) {
      resetCardIds();
      try {
        // Mirror matchup: both players are the same character
        const game = new Game({
          playerFactories: [createSquashBot as PlayerFactory, createSquashBot as PlayerFactory],
          names: ["P0", "P1"],
          chars: [char, char],
        });
        const winner = game.play();
        const winnerIdx = winner.name === "P0" ? 0 : 1;

        // Track BOTH players — each is same character, different cards purchased
        for (let p = 0; p < 2; p++) {
          const player = game.players[p];
          const playerWon = p === winnerIdx;
          const ownedCards = getOwnedCardNames(player);

          for (const cardName of ownedCards) {
            if (!stats[char][cardName]) {
              stats[char][cardName] = { wins: 0, total: 0 };
            }
            stats[char][cardName].total += 1;
            stats[char][cardName].wins += playerWon ? 1 : -1;
          }
        }

        gamesPlayed++;
      } catch {
        // crash — skip
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ${char}: ${gamesPerChar} mirror games done (${elapsed}s elapsed)`);
  }

  // Write output files
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  for (const char of chars) {
    const charStats = stats[char];
    const weights: WeightData = {};
    for (const [cardName, s] of Object.entries(charStats)) {
      const winRate = s.total > 0 ? s.wins / s.total : 0;
      weights[cardName] = [s.wins, s.total, winRate];
    }
    const path = `${outputDir}/${char}.json`;
    writeFileSync(path, JSON.stringify(weights, null, 2));
    console.log(`  Wrote ${path} (${Object.keys(weights).length} cards)`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nTotal: ${gamesPlayed} games in ${elapsed}s`);

  // Print top/bottom cards per character for sanity check
  console.log("\n=== Top/Bottom Cards Per Character (V2 self-play) ===");
  for (const char of chars) {
    const entries = Object.entries(stats[char])
      .filter(([, s]) => s.total >= 10)
      .map(([name, s]) => ({ name, winRate: s.wins / s.total, total: s.total }))
      .sort((a, b) => b.winRate - a.winRate);

    console.log(`\n${char}:`);
    console.log("  TOP 8:");
    for (const e of entries.slice(0, 8)) {
      console.log(`    ${e.name.padEnd(22)} ${(e.winRate * 100).toFixed(1).padStart(6)}%  (n=${e.total})`);
    }
    console.log("  BOTTOM 5:");
    for (const e of entries.slice(-5)) {
      console.log(`    ${e.name.padEnd(22)} ${(e.winRate * 100).toFixed(1).padStart(6)}%  (n=${e.total})`);
    }
  }
}

// ── CLI entry point ──

const gamesPerChar = parseInt(process.argv[2] || "500", 10);
const outputDir = process.argv[3] || "client/src/engine/data/squash_weights";
const explorationRate = parseFloat(process.argv[4] || "0");
SquashBot.explorationRate = explorationRate;
if (explorationRate > 0) {
  console.log(`Exploration rate: ${explorationRate}`);
}

// Ensure parent exists
if (!existsSync(dirname(outputDir))) {
  mkdirSync(dirname(outputDir), { recursive: true });
}

runSelfPlay(gamesPerChar, outputDir);
