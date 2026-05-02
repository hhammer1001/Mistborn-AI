/**
 * selfplayZoomVsSquashTimed.ts — Asymmetric timing data: Squash seat 1, Zoom
 * seat 2, recording only Zoom's acquisition timing per turn-bucket.
 * Companion to selfplayZoomVsSquash.ts — keep them trained in lockstep.
 */

import { Game, type PlayerFactory } from "./game";
import { createSquashBot } from "./squashBot";
import { createZoomBot } from "./zoomBot";
import { resetCardIds } from "./card";
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

function runAsymmetric(gamesPerPair: number, outputDir: string) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];

  const stats: Record<string, Record<string, CardTimingData>> = {};
  for (const c of chars) stats[c] = {};

  console.log(`\nAsymmetric timing: Squash (seat 1) vs Zoom (seat 2). ${gamesPerPair} games per (Zoom-char × Squash-char) pair.\n`);
  const start = Date.now();

  for (const zoomChar of chars) {
    for (const squashChar of chars) {
      for (let i = 0; i < gamesPerPair; i++) {
        resetCardIds();
        const game = new Game({
          playerFactories: [createSquashBot as PlayerFactory, createZoomBot as PlayerFactory],
          names: ["Squash", "Zoom"],
          chars: [squashChar, zoomChar],
        });

        // Track Zoom (seat 1 in players array)'s buys with turn
        const zoomBuys: Array<{ name: string; turn: number }> = [];
        const zoom = game.players[1] as Player;
        const orig = zoom.performAction.bind(zoom);
        zoom.performAction = function (action: GameActionInternal, g: Game) {
          if (action.type === "buy" || action.type === "buy_eliminate"
            || action.type === "buy_with_boxings" || action.type === "buy_elim_boxings") {
            const card = (action as unknown as { card: { name: string } }).card;
            zoomBuys.push({ name: card.name, turn: g.turncount });
          }
          orig(action, g);
        };

        const winner = game.play();
        const zoomWon = winner.name === "Zoom";

        for (const acq of zoomBuys) {
          if (!stats[zoomChar][acq.name]) stats[zoomChar][acq.name] = emptyTiming();
          const bucket = bucketFor(acq.turn);
          stats[zoomChar][acq.name][bucket].total += 1;
          stats[zoomChar][acq.name][bucket].wins += zoomWon ? 1 : -1;
        }
      }
    }
    console.log(`  Zoom-${zoomChar}: vs all 5 Squash chars done (${((Date.now() - start) / 1000).toFixed(1)}s)`);
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

const gamesPerPair = parseInt(process.argv[2] || "2000", 10);
const outputDir = process.argv[3] || "client/src/engine/data/zoom_timing";
runAsymmetric(gamesPerPair, outputDir);
