/**
 * selfplayZoomVsSquash.ts — Asymmetric training: Squash always seat 1, Zoom
 * always seat 2, record only Zoom's outcomes.
 *
 * Motivation: mirror Zoom-vs-Zoom training gives Zoom signal about what wins
 * from seat 2 against ANOTHER ZoomBot. But the opponent we actually care
 * about is Squash-as-seat-1 (the strongest first-seat bot we have). Training
 * directly against that matchup gives weights tuned for the matchup we
 * benchmark, not against an opponent that itself plays seat 1 sub-optimally.
 *
 * Trade-off: this overfits Zoom to Squash-specifically rather than learning
 * a generalizable seat-2 strategy. That's acceptable when the goal is
 * winning the Zoom-vs-Squash matchup directly.
 *
 * Run: npx tsx client/src/engine/selfplayZoomVsSquash.ts [gamesPerChar]
 */

import { Game, type PlayerFactory } from "./game";
import { createSquashBot } from "./squashBot";
import { createZoomBot } from "./zoomBot";
import { resetCardIds } from "./card";
import type { Player } from "./player";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";

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

function runAsymmetric(gamesPerChar: number, outputDir: string) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];

  const stats: Record<string, Record<string, CardStat>> = {};
  for (const c of chars) stats[c] = {};

  // For each Zoom character we want training for, iterate over EVERY Squash
  // first-seat character to spread the signal across realistic matchups.
  // (Mirror chars=[c,c] is just one of 5 options when training Zoom-as-c.)
  console.log(`\nAsymmetric training: Squash (seat 1) vs Zoom (seat 2).`);
  console.log(`Recording ${gamesPerChar} games per (Zoom-char × Squash-char) pair.\n`);

  const startTime = Date.now();
  let gamesPlayed = 0;

  for (const zoomChar of chars) {
    for (const squashChar of chars) {
      for (let i = 0; i < gamesPerChar; i++) {
        resetCardIds();
        try {
          const game = new Game({
            playerFactories: [createSquashBot as PlayerFactory, createZoomBot as PlayerFactory],
            names: ["Squash", "Zoom"],
            chars: [squashChar, zoomChar],
          });
          const winner = game.play();
          const zoomWon = winner.name === "Zoom";

          // Only record Zoom's data (seat 1 in players array)
          const zoomPlayer = game.players[1];
          const ownedCards = getOwnedCardNames(zoomPlayer);

          for (const cardName of ownedCards) {
            if (!stats[zoomChar][cardName]) {
              stats[zoomChar][cardName] = { wins: 0, total: 0 };
            }
            stats[zoomChar][cardName].total += 1;
            stats[zoomChar][cardName].wins += zoomWon ? 1 : -1;
          }

          gamesPlayed++;
        } catch {
          // crash — skip
        }
      }
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  Zoom-${zoomChar}: trained vs all 5 Squash chars (${elapsed}s elapsed)`);
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

  console.log("\n=== Top/Bottom Cards Per Character (Zoom seat-2 vs Squash seat-1) ===");
  for (const char of chars) {
    const entries = Object.entries(stats[char])
      .filter(([, s]) => s.total >= 50)
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

// CLI: gamesPerChar means games per (zoomChar × squashChar) pair, so total = N*25
const gamesPerChar = parseInt(process.argv[2] || "2000", 10);
const outputDir = process.argv[3] || "client/src/engine/data/zoom_weights";

if (!existsSync(dirname(outputDir))) {
  mkdirSync(dirname(outputDir), { recursive: true });
}

runAsymmetric(gamesPerChar, outputDir);
