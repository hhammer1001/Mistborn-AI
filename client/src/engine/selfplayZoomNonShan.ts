/**
 * selfplayZoomNonShan.ts — Targeted training for Kelsier/Vin/Marsh/Prodigy
 * Zoom chars (excludes Shan, which has its own dedicated script). Mirrors
 * selfplayZoomShanOnly's structure but iterates the 4 non-Shan chars.
 *
 * Run: npx tsx client/src/engine/selfplayZoomNonShan.ts [gamesPerOppPerChar]
 */

import { Game, type PlayerFactory } from "./game";
import { createSquashBot } from "./squashBot";
import { createZoomBot, ZoomBot } from "./zoomBot";
import { resetCardIds } from "./card";
import type { Player } from "./player";
import { writeFileSync, existsSync, mkdirSync } from "fs";

ZoomBot.seat2Variance = 0;
ZoomBot.lookaheadEnabled = false;

interface CardStat { wins: number; total: number; }

function getOwnedCardNames(player: Player): Set<string> {
  const names = new Set<string>();
  for (const c of player.deck.hand) names.add(c.name);
  for (const c of player.deck.discard) names.add(c.name);
  for (const c of player.deck.cards) names.add(c.name);
  for (const a of player.allies) names.add(a.name);
  return names;
}

function run(gamesPerOpp: number) {
  const opps = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
  const zoomChars = ["Kelsier", "Vin", "Marsh", "Prodigy"];
  console.log(`\n${gamesPerOpp} games per (opp × zoom-char) — non-Shan zoom only`);
  const start = Date.now();

  for (const zoom of zoomChars) {
    for (const opp of opps) {
      const stats: Record<string, CardStat> = {};
      let played = 0;
      for (let i = 0; i < gamesPerOpp; i++) {
        resetCardIds();
        try {
          const game = new Game({
            playerFactories: [createSquashBot as PlayerFactory, createZoomBot as PlayerFactory],
            names: ["Squash", "Zoom"],
            chars: [opp, zoom],
          });
          const winner = game.play();
          const zoomWon = winner.name === "Zoom";
          const owned = getOwnedCardNames(game.players[1]);
          for (const name of owned) {
            if (!stats[name]) stats[name] = { wins: 0, total: 0 };
            stats[name].total += 1;
            stats[name].wins += zoomWon ? 1 : -1;
          }
          played++;
        } catch { /* skip */ }
      }
      const out: Record<string, [number, number, number]> = {};
      for (const [name, s] of Object.entries(stats)) {
        const wr = s.total > 0 ? s.wins / s.total : 0;
        out[name] = [s.wins, s.total, wr];
      }
      const oppLower = opp.toLowerCase();
      const dir = `client/src/engine/data/zoom_vs_${oppLower}`;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const path = `${dir}/${zoom}.json`;
      writeFileSync(path, JSON.stringify(out, null, 2));
      console.log(`  zoom=${zoom} opp=${opp}: ${played} games, wrote ${path} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    }
  }
}

const games = parseInt(process.argv[2] || "200000", 10);
run(games);
