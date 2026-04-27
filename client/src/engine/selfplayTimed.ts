/**
 * selfplayTimed.ts — Track turn-of-acquisition for each market card bought
 * during self-play. Lets us identify cards whose value depends strongly on
 * when they enter your deck (premium-early cards worth saving for vs late-
 * pickups vs cards that don't care).
 *
 * Output: client/src/engine/data/squash_timing/{Character}.json
 *   {
 *     "Pierce": {
 *       "1-3":  [wins_delta, total, winRate],
 *       "4-8":  [wins_delta, total, winRate],
 *       "9-15": [wins_delta, total, winRate],
 *       "16+":  [wins_delta, total, winRate]
 *     },
 *     ...
 *   }
 *
 * Run: npx tsx client/src/engine/selfplayTimed.ts [gamesPerChar]
 */

import { Game, type PlayerFactory } from "./game";
import { createSquashBot } from "./squashBot";
import { resetCardIds } from "./card";
import type { Player } from "./player";
import type { GameActionInternal } from "./types";
import { writeFileSync, mkdirSync, existsSync } from "fs";

// Buckets in turns
const BUCKETS = [
  { name: "1-3", lo: 1, hi: 3 },
  { name: "4-8", lo: 4, hi: 8 },
  { name: "9-15", lo: 9, hi: 15 },
  { name: "16+", lo: 16, hi: 999 },
] as const;
type BucketName = (typeof BUCKETS)[number]["name"];

function bucketFor(turn: number): BucketName {
  for (const b of BUCKETS) {
    if (turn >= b.lo && turn <= b.hi) return b.name;
  }
  return "16+";
}

interface CardStat { wins: number; total: number; }
type CardTimingData = Record<BucketName, CardStat>;

function emptyTiming(): CardTimingData {
  return { "1-3": { wins: 0, total: 0 }, "4-8": { wins: 0, total: 0 }, "9-15": { wins: 0, total: 0 }, "16+": { wins: 0, total: 0 } };
}

function runSelfPlay(gamesPerChar: number, outputDir: string) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];

  // stats[char][cardName][bucket] = CardStat
  const stats: Record<string, Record<string, CardTimingData>> = {};
  for (const c of chars) stats[c] = {};

  console.log(`\nRunning ${gamesPerChar} mirror games per character (timed acquisition)\n`);
  const start = Date.now();

  for (const char of chars) {
    for (let i = 0; i < gamesPerChar; i++) {
      resetCardIds();
      const game = new Game({
        playerFactories: [createSquashBot as PlayerFactory, createSquashBot as PlayerFactory],
        names: ["P0", "P1"],
        chars: [char, char],
      });

      // Each player tracks (cardName, turnAcquired) for cards they bought
      const acquisitions: [Array<{ name: string; turn: number }>, Array<{ name: string; turn: number }>] = [[], []];

      for (let p = 0; p < 2; p++) {
        const bot = game.players[p] as Player;
        const orig = bot.performAction.bind(bot);
        bot.performAction = function (action: GameActionInternal, g: Game) {
          // Capture buys (any kind)
          if (action.type === "buy" || action.type === "buy_eliminate"
            || action.type === "buy_with_boxings" || action.type === "buy_elim_boxings") {
            const card = (action as unknown as { card: { name: string } }).card;
            acquisitions[p].push({ name: card.name, turn: g.turncount });
          }
          orig(action, g);
        };
      }

      const winner = game.play();
      const winnerIdx = winner.name === "P0" ? 0 : 1;

      // Record outcomes per acquisition
      for (let p = 0; p < 2; p++) {
        const won = p === winnerIdx;
        for (const acq of acquisitions[p]) {
          if (!stats[char][acq.name]) stats[char][acq.name] = emptyTiming();
          const bucket = bucketFor(acq.turn);
          stats[char][acq.name][bucket].total += 1;
          stats[char][acq.name][bucket].wins += won ? 1 : -1;
        }
      }
    }
    console.log(`  ${char}: ${gamesPerChar} games (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  }

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  for (const char of chars) {
    const out: Record<string, Record<string, [number, number, number]>> = {};
    for (const [cardName, timing] of Object.entries(stats[char])) {
      out[cardName] = {};
      for (const b of BUCKETS) {
        const s = timing[b.name];
        const wr = s.total > 0 ? s.wins / s.total : 0;
        out[cardName][b.name] = [s.wins, s.total, wr];
      }
    }
    writeFileSync(`${outputDir}/${char}.json`, JSON.stringify(out, null, 2));
  }
  console.log(`\nDone. Files in ${outputDir}.`);

  // Print analysis: cards whose winrate decreases sharply with turn acquired
  console.log(`\n=== Cards with biggest early-vs-late winrate gap (premium-early candidates) ===`);
  for (const char of chars) {
    console.log(`\n${char}:`);
    const interesting: Array<{ name: string; early: number; late: number; gap: number; nE: number; nL: number }> = [];
    for (const [name, timing] of Object.entries(stats[char])) {
      const early = timing["1-3"];
      const lateA = timing["9-15"];
      const lateB = timing["16+"];
      const lateTotal = lateA.total + lateB.total;
      const lateWins = lateA.wins + lateB.wins;
      if (early.total < 50 || lateTotal < 50) continue;
      const earlyRate = early.wins / early.total;
      const lateRate = lateWins / lateTotal;
      const gap = earlyRate - lateRate;
      interesting.push({ name, early: earlyRate, late: lateRate, gap, nE: early.total, nL: lateTotal });
    }
    interesting.sort((a, b) => b.gap - a.gap);
    console.log(`  ${"Card".padEnd(20)} ${"Turn 1-3".padStart(10)} ${"Turn 9+".padStart(10)} ${"Gap".padStart(8)}  (n)`);
    for (const x of interesting.slice(0, 8)) {
      console.log(`  ${x.name.padEnd(20)} ${(x.early * 100).toFixed(1).padStart(8)}% ${(x.late * 100).toFixed(1).padStart(8)}% ${(x.gap * 100).toFixed(1).padStart(7)}  (${x.nE}/${x.nL})`);
    }
  }
}

const gamesPerChar = parseInt(process.argv[2] || "10000", 10);
const outputDir = process.argv[3] || "client/src/engine/data/squash_timing";
runSelfPlay(gamesPerChar, outputDir);
