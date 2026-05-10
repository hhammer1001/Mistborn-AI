/**
 * selfplaySquashV2VsZoom.ts — Asymmetric training: SquashV2 always seat 0,
 * Zoom always seat 1. Records only SquashV2's outcomes.
 *
 * Generates per-(squashV2 char × zoom char) data files, one per zoom-char
 * directory: `data/squashV2_vs_<zoomChar>/<v2Char>.json`. Mirrors the layout
 * of `data/zoom_vs_<oppChar>/<zoomChar>.json` but trained from the opposite
 * seat. At runtime, dynamicCardRating consults VS_OPP_LIFTS_SQUASHV2 keyed
 * by snap.oppCharacter (= the seat-1 Zoom's character).
 *
 * Why train against Zoom and not Squash? Zoom is the strongest seat-1 bot
 * we have — training SquashV2 weights against the weakest opp would leave
 * Squash ineffective when faced with Zoom in real play. Asymmetric SquashV2
 * vs Zoom trades generality for matchup-specific lift.
 *
 * Run: npx tsx client/src/engine/selfplaySquashV2VsZoom.ts [gamesPerPair]
 * Pairs = 5×5 = 25, total games = gamesPerPair × 25.
 */

import { Game, type PlayerFactory } from "./game";
import { createSquashV2Bot, SquashV2Bot } from "./squashV2Bot";
import { createZoomBot, ZoomBot } from "./zoomBot";
import { resetCardIds } from "./card";
import type { Player } from "./player";
import { writeFileSync, mkdirSync, existsSync } from "fs";

// Disable lookahead for both during training (consistent with how the runtime
// data is consumed — lookahead is added on top of clean trained weights).
SquashV2Bot.lookaheadEnabled = false;
ZoomBot.lookaheadEnabled = false;

// vs-opp blend setting during training. blend=0 (clean break) underperforms
// because V2 plays at a disadvantage against trained-Zoom (different from
// runtime equilibrium). blend=runtime-default (40) re-trained at 5k/pair
// hit 68.5%, but at 20k/pair regressed (feedback compounding). Sweet spot
// requires more iteration; default to using existing weights (no override).

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

function runAsymmetric(gamesPerPair: number) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];

  // stats[zoomChar][v2Char][cardName] = CardStat
  const stats: Record<string, Record<string, Record<string, CardStat>>> = {};
  for (const z of chars) {
    stats[z] = {};
    for (const v of chars) stats[z][v] = {};
  }

  console.log(`\nAsymmetric training: SquashV2 (seat 0) vs Zoom (seat 1).`);
  console.log(`Recording ${gamesPerPair} games per (V2-char × Zoom-char) pair (25 pairs total).\n`);

  const startTime = Date.now();
  let gamesPlayed = 0;

  for (const v2Char of chars) {
    for (const zoomChar of chars) {
      for (let i = 0; i < gamesPerPair; i++) {
        resetCardIds();
        try {
          const game = new Game({
            playerFactories: [createSquashV2Bot as PlayerFactory, createZoomBot as PlayerFactory],
            names: ["V2", "Zoom"],
            chars: [v2Char, zoomChar],
          });
          const winner = game.play();
          const v2Won = winner.name === "V2";

          const v2Player = game.players[0];
          const ownedCards = getOwnedCardNames(v2Player);

          for (const cardName of ownedCards) {
            if (!stats[zoomChar][v2Char][cardName]) {
              stats[zoomChar][v2Char][cardName] = { wins: 0, total: 0 };
            }
            stats[zoomChar][v2Char][cardName].total += 1;
            stats[zoomChar][v2Char][cardName].wins += v2Won ? 1 : -1;
          }

          gamesPlayed++;
        } catch {
          // crash — skip
        }
      }
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  V2-${v2Char}: trained vs all 5 Zoom chars (${elapsed}s elapsed)`);
  }

  // Write 5 directories, each with 5 files (one per V2 char).
  const charLower: Record<string, string> = {
    Kelsier: "kelsier", Shan: "shan", Vin: "vin", Marsh: "marsh", Prodigy: "prodigy",
  };
  for (const zoomChar of chars) {
    const dir = `client/src/engine/data/squashV2_vs_${charLower[zoomChar]}`;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    for (const v2Char of chars) {
      const charStats = stats[zoomChar][v2Char];
      const weights: WeightData = {};
      for (const [cardName, s] of Object.entries(charStats)) {
        const winRate = s.total > 0 ? s.wins / s.total : 0;
        weights[cardName] = [s.wins, s.total, winRate];
      }
      const path = `${dir}/${v2Char}.json`;
      writeFileSync(path, JSON.stringify(weights, null, 2));
    }
    console.log(`  Wrote ${dir}/ (5 files)`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nTotal: ${gamesPlayed} games in ${elapsed}s`);

  console.log("\n=== Top cards per (V2-char, Zoom-char) pair (top 5 each) ===");
  for (const v2Char of chars) {
    for (const zoomChar of chars) {
      const charStats = stats[zoomChar][v2Char];
      const entries = Object.entries(charStats)
        .filter(([, s]) => s.total >= 50)
        .map(([name, s]) => ({ name, wr: s.wins / s.total }))
        .sort((a, b) => b.wr - a.wr);
      const top = entries.slice(0, 5).map((e) => `${e.name}:${(e.wr * 100).toFixed(0)}`).join(" ");
      console.log(`  V2-${v2Char.padEnd(8)} vs Zoom-${zoomChar.padEnd(8)}  ${top}`);
    }
  }
}

const gamesPerPair = parseInt(process.argv[2] || "2000", 10);
runAsymmetric(gamesPerPair);
