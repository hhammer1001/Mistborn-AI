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
import { trainingChars } from "./trainingChars";
import type { Player } from "./player";
import { mergeVsOpp, type VsOppTable, type WeightData } from "./vsOppStore";

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

function getOwnedCardNames(player: Player): Set<string> {
  const names = new Set<string>();
  for (const c of player.deck.hand) names.add(c.name);
  for (const c of player.deck.discard) names.add(c.name);
  for (const c of player.deck.cards) names.add(c.name);
  for (const a of player.allies) names.add(a.name);
  return names;
}

function runAsymmetric(gamesPerPair: number) {
  // Two independent selectors so a run can fill just the missing slice of the
  // matrix. V2_CHARS picks the seat-0 SquashV2 characters, ZOOM_CHARS the
  // seat-1 opponents; only the (opp, bot) pairs actually played get merged, so
  // pairs trained in an earlier run survive untouched.
  const v2Chars = trainingChars("V2_CHARS");
  const zoomChars = trainingChars("ZOOM_CHARS");

  // stats[zoomChar][v2Char][cardName] = CardStat
  const stats: Record<string, Record<string, Record<string, CardStat>>> = {};
  for (const z of zoomChars) {
    stats[z] = {};
    for (const v of v2Chars) stats[z][v] = {};
  }

  console.log(`\nAsymmetric training: SquashV2 (seat 0) vs Zoom (seat 1).`);
  console.log(`Recording ${gamesPerPair} games per (V2-char × Zoom-char) pair (25 pairs total).\n`);

  const startTime = Date.now();
  let gamesPlayed = 0;

  for (const v2Char of v2Chars) {
    for (const zoomChar of zoomChars) {
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
    console.log(`  V2-${v2Char}: trained vs ${zoomChars.length} Zoom char(s) (${elapsed}s elapsed)`);
  }

  // Merge one slice per opposing (Zoom) character, each holding one entry per V2 char.
  const slice: VsOppTable = {};
  for (const zoomChar of zoomChars) {
    slice[zoomChar] = {};
    for (const v2Char of v2Chars) {
      const charStats = stats[zoomChar][v2Char];
      const weights: WeightData = {};
      for (const [cardName, s] of Object.entries(charStats)) {
        const winRate = s.total > 0 ? s.wins / s.total : 0;
        weights[cardName] = [s.wins, s.total, winRate];
      }
      slice[zoomChar][v2Char] = weights;
    }
  }
  mergeVsOpp("squashV2", slice);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nTotal: ${gamesPlayed} games in ${elapsed}s`);

  console.log("\n=== Top cards per (V2-char, Zoom-char) pair (top 5 each) ===");
  for (const v2Char of v2Chars) {
    for (const zoomChar of zoomChars) {
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
