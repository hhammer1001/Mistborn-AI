/**
 * selfplayZoomTimed.ts — Phase-aware acquisition timing data for ZoomBot,
 * recorded only from the SECOND-PLAYER seat. Mirror of selfplayTimed.ts but
 * uses ZoomBot mirrors and seat-2-only outcomes (matches selfplayZoom.ts).
 *
 * The output buckets card-buy events by turn-of-acquisition (1-3, 4-8, 9-15,
 * 16+) and records the seat-2 win rate for each card-bucket combo. squashBotEval
 * uses each card's lift over the bucket baseline as a phase-aware adjustment
 * to the card's rating.
 *
 * Output: client/src/engine/data/zoom_timing/<Character>.json
 *
 * Run with: npx tsx client/src/engine/selfplayZoomTimed.ts [gamesPerChar]
 */

import { Game, type PlayerFactory } from "./game";
import { createZoomBot, ZoomBot } from "./zoomBot";
import { createSquashBot } from "./squashBot";

// Disable lookahead during training (matches selfplayZoom.ts).
ZoomBot.seat2Variance = 0;
ZoomBot.lookaheadEnabled = false;

// Match selfplayZoom.ts ratio (0 = mirror only, after testing showed asymmetric mix regresses).
const ASYMMETRIC_RATIO = 0;
import { resetCardIds } from "./card";
import { trainingChars } from "./trainingChars";
import type { Player } from "./player";
import type { GameActionInternal } from "./types";
import { writeFileSync, mkdirSync, existsSync } from "fs";

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
  const chars = trainingChars();

  const stats: Record<string, Record<string, CardTimingData>> = {};
  for (const c of chars) stats[c] = {};

  console.log(`\nRunning ${gamesPerChar} mirror games per character (Zoom timed acquisition, seat 2 only).\n`);
  const start = Date.now();

  for (const char of chars) {
    for (let i = 0; i < gamesPerChar; i++) {
      const seat1Char = chars[Math.floor(Math.random() * chars.length)];
      const useSquashSeat1 = Math.random() < ASYMMETRIC_RATIO;
      const seat1Factory = useSquashSeat1 ? createSquashBot : createZoomBot;
      resetCardIds();
      const game = new Game({
        playerFactories: [seat1Factory as PlayerFactory, createZoomBot as PlayerFactory],
        names: ["P0", "P1"],
        chars: [seat1Char, char],
      });

      // Track buys for both players, but only RECORD seat-2 outcomes after.
      const acquisitions: [Array<{ name: string; turn: number }>, Array<{ name: string; turn: number }>] = [[], []];

      for (let p = 0; p < 2; p++) {
        const bot = game.players[p] as Player;
        const orig = bot.performAction.bind(bot);
        bot.performAction = function (action: GameActionInternal, g: Game) {
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

      // ── Seat-2 only ──
      const seat = 1;
      const won = seat === winnerIdx;
      for (const acq of acquisitions[seat]) {
        if (!stats[char][acq.name]) stats[char][acq.name] = emptyTiming();
        const bucket = bucketFor(acq.turn);
        stats[char][acq.name][bucket].total += 1;
        stats[char][acq.name][bucket].wins += won ? 1 : -1;
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

  console.log(`\n=== Zoom seat-2 timing — biggest early-vs-late gap per character ===`);
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
const outputDir = process.argv[3] || "client/src/engine/data/zoom_timing";
runSelfPlay(gamesPerChar, outputDir);
