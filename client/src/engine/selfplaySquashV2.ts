/**
 * selfplaySquashV2.ts — Generate going-FIRST-only training data for SquashV2Bot.
 *
 * Mirror matchups (same character both sides). Records ONLY the seat-0 (first
 * player) outcomes per game — the corollary to selfplayZoom.ts which records
 * only seat-2 outcomes. This biases the resulting weights toward whatever
 * wins from a tempo-advantage position.
 *
 * Output: client/src/engine/data/squashV2_weights/<Character>.json
 * Format: { "CardName": [wins_delta, total, winRate] }
 *
 * Important: bootstrap with `SquashV2Config.selfPlayBlend = 0` to avoid
 * feedback loops — the bot should train against analytical-only ratings,
 * then use the resulting data with blend > 0 at runtime.
 *
 * Run: npx tsx client/src/engine/selfplaySquashV2.ts [gamesPerChar]
 */

import { Game, type PlayerFactory } from "./game";
import { createSquashV2Bot, SquashV2Bot } from "./squashV2Bot";
import { resetCardIds } from "./card";
import type { Player } from "./player";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { SquashV2Config, recomputeSquashV2Ratings, recomputeSquashV2VsOppLifts } from "./squashBotEval";

// Disable runtime layers during training — heuristic-only signal.
// (Zoom's tests showed lookahead-trained data regressed.)
SquashV2Bot.lookaheadEnabled = false;

interface CardStat {
  wins: number;
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

  console.log(`\nRunning ${gamesPerChar} mirror games per character (${gamesPerChar * chars.length} total SquashV2-vs-SquashV2 games).`);
  console.log("Recording the FIRST-PLAYER seat only.\n");

  const startTime = Date.now();
  let gamesPlayed = 0;

  for (const char of chars) {
    const charStart = Date.now();
    for (let i = 0; i < gamesPerChar; i++) {
      if (i > 0 && i % 1000 === 0) {
        console.log(`    ${char}: ${i}/${gamesPerChar} (${((Date.now() - charStart) / 1000).toFixed(1)}s)`);
      }
      // seat 0 is always SquashV2-of-char (the seat we're recording).
      // seat 1 is randomly chosen from chars to spread signal across realistic
      // first-seat opponents (mirror = char-vs-char eliminates char variance,
      // but we want signal across opp diversity for the seat we record).
      const seat1Char = chars[Math.floor(Math.random() * chars.length)];

      resetCardIds();
      try {
        const game = new Game({
          playerFactories: [createSquashV2Bot as PlayerFactory, createSquashV2Bot as PlayerFactory],
          names: ["P0", "P1"],
          chars: [char, seat1Char],
        });
        const winner = game.play();
        const winnerIdx = winner.name === "P0" ? 0 : 1;

        // ── seat 0 only ──
        const seat = 0;
        const player = game.players[seat];
        const playerWon = seat === winnerIdx;
        const ownedCards = getOwnedCardNames(player);

        for (const cardName of ownedCards) {
          if (!stats[char][cardName]) {
            stats[char][cardName] = { wins: 0, total: 0 };
          }
          stats[char][cardName].total += 1;
          stats[char][cardName].wins += playerWon ? 1 : -1;
        }

        gamesPlayed++;
      } catch {
        // crash — skip
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ${char}: ${gamesPerChar} games (random opp char) done (${elapsed}s elapsed)`);
  }

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

  console.log("\n=== Top/Bottom Cards Per Character (SquashV2 — first-player seat) ===");
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

// ── CLI ──

const gamesPerChar = parseInt(process.argv[2] || "500", 10);
const outputDir = process.argv[3] || "client/src/engine/data/squashV2_weights";

// Bootstrap with blend=0 to break feedback loops. The CLI flag --keep-blend
// allows training subsequent iterations with the existing blend.
//
// NOTE: when the data files are EMPTY stubs, blend=0 vs blend=80 yields
// identical ratings (the lookup misses on min-samples). The recompute calls
// only matter once data is populated. Skipping them on first bootstrap.
if (process.argv.includes("--blend-zero")) {
  SquashV2Config.selfPlayBlend = 0;
  recomputeSquashV2Ratings();
  recomputeSquashV2VsOppLifts();
  console.log(`(Blend=0 for retrain — pass without --blend-zero to keep current blend)`);
}

if (!existsSync(dirname(outputDir))) {
  mkdirSync(dirname(outputDir), { recursive: true });
}

runSelfPlay(gamesPerChar, outputDir);
