/**
 * selfplaySquashV2Timed.ts — Phase-aware acquisition timing data for
 * SquashV2Bot, recorded only from the FIRST-PLAYER seat. Mirror of
 * selfplayZoomTimed.ts but uses SquashV2Bot mirrors and seat-0-only outcomes.
 *
 * Output: client/src/engine/data/squashV2_timing/<Character>.json
 *
 * Run: npx tsx client/src/engine/selfplaySquashV2Timed.ts [gamesPerChar]
 *
 * IMPORTANT: train timing IMMEDIATELY after self-play (not before, not weeks
 * later) — timing baselines must be derived from the same bot snapshot the
 * self-play data came from. Skipping or running out of order regresses the
 * bot. This rule was learned painfully on Zoom (-6pp from stale baselines).
 */

import { Game, type PlayerFactory } from "./game";
import { createSquashV2Bot, SquashV2Bot } from "./squashV2Bot";
import { resetCardIds } from "./card";
import { trainingChars } from "./trainingChars";
import type { Player } from "./player";
import type { GameActionInternal } from "./types";
import { writeFileSync, mkdirSync, existsSync } from "fs";

SquashV2Bot.lookaheadEnabled = false;

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

  console.log(`\nRunning ${gamesPerChar} mirror games per character (SquashV2 timed acquisition, seat 0 only).\n`);
  const start = Date.now();

  for (const char of chars) {
    for (let i = 0; i < gamesPerChar; i++) {
      const seat1Char = chars[Math.floor(Math.random() * chars.length)];
      resetCardIds();
      const game = new Game({
        playerFactories: [createSquashV2Bot as PlayerFactory, createSquashV2Bot as PlayerFactory],
        names: ["P0", "P1"],
        chars: [char, seat1Char],
      });

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

      // ── Seat-0 only ──
      const seat = 0;
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
}

const gamesPerChar = parseInt(process.argv[2] || "10000", 10);
const outputDir = process.argv[3] || "client/src/engine/data/squashV2_timing";
runSelfPlay(gamesPerChar, outputDir);
