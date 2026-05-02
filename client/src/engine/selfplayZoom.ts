/**
 * selfplayZoom.ts — Generate going-second-only training data for ZoomBot.
 *
 * Method: ZoomBot mirror matchups (same character both sides). Unlike
 * `selfplay.ts` which records BOTH players' card outcomes per game (doubling
 * sample efficiency for a generic mirror), this script ONLY records data from
 * the SECOND-PLAYER seat. That biases the resulting weights toward whatever
 * wins from a tempo-deficit position — exactly the conditions Zoom faces.
 *
 * Output: client/src/engine/data/zoom_weights/<Character>.json
 * Format (matches squash_weights): { "CardName": [wins_delta, total, winRate] }
 *
 * Companion timing data lives in selfplayZoomTimed.ts (TODO) — for now this
 * script only generates the headline self-play correlations.
 *
 * Run with: npx tsx client/src/engine/selfplayZoom.ts [gamesPerChar]
 *
 * Notes:
 * - To bootstrap, run with `SELFPLAY_BLEND_STRENGTH = 0` for the zoom profile
 *   so the bot trains against analytical-only ratings (avoids feedback loops).
 *   See BOT_NOTES.md "Self-Play Pipeline".
 * - Initially zoom_weights are empty stubs, so Zoom and Squash play identically
 *   on a fresh checkout. After this script runs, Zoom diverges.
 */

import { Game, type PlayerFactory } from "./game";
import { createZoomBot, ZoomBot } from "./zoomBot";
import { createSquashBot } from "./squashBot";

// Disable runtime variance and lookahead during training. Keeps training
// fast and the card-weight signal clean (heuristic-only play). Lookahead
// layers on at runtime over the trained weights.
//
// Tested ENABLED for training: regressed (32.6% vs 36-37% with lookahead at
// runtime only). The lookahead during training apparently picks different
// actions that don't expose card values as cleanly as heuristic-greedy.
ZoomBot.seat2Variance = 0;
ZoomBot.lookaheadEnabled = false;

// Probability of using SquashBot (target opponent) as seat 1 instead of
// ZoomBot (mirror). Tested 0.5 — regressed to 32.4% from baseline 34-37%.
// Mirror-only is empirically better.
const ASYMMETRIC_RATIO = 0;
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

  console.log(
    `\nRunning ${gamesPerChar} mirror games per character (${gamesPerChar * chars.length} total Zoom-vs-Zoom games).`,
  );
  console.log("Recording the SECOND-PLAYER seat only.\n");

  const startTime = Date.now();
  let gamesPlayed = 0;

  for (const char of chars) {
    for (let i = 0; i < gamesPerChar; i++) {
      // Random-char + mixed-source: seat 1 randomly Zoom (mirror) or Squash
      // (asymmetric, target-matchup signal). seat 2 is always Zoom-of-char.
      const seat1Char = chars[Math.floor(Math.random() * chars.length)];
      const useSquashSeat1 = Math.random() < ASYMMETRIC_RATIO;
      const seat1Factory = useSquashSeat1 ? createSquashBot : createZoomBot;

      resetCardIds();
      try {
        const game = new Game({
          playerFactories: [seat1Factory as PlayerFactory, createZoomBot as PlayerFactory],
          names: ["P0", "P1"],
          chars: [seat1Char, char],
        });
        const winner = game.play();
        const winnerIdx = winner.name === "P0" ? 0 : 1;

        // ── seat 2 only ──
        const seat = 1;
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

  console.log("\n=== Top/Bottom Cards Per Character (Zoom — second-player seat) ===");
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
const outputDir = process.argv[3] || "client/src/engine/data/zoom_weights";

if (!existsSync(dirname(outputDir))) {
  mkdirSync(dirname(outputDir), { recursive: true });
}

runSelfPlay(gamesPerChar, outputDir);
