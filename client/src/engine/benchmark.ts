/**
 * benchmark.ts — Bot-vs-bot test harness.
 * Run with: npx tsx client/src/engine/benchmark.ts [numGames]
 *
 * Tests TwonkyV2 vs TwonkyV1 across all character matchups.
 */

import { Game, type PlayerFactory } from "./game";
import { createTwonky } from "./bot";
import { createTwonkyV2 } from "./botV2";
import { resetCardIds } from "./card";

interface MatchResult {
  winnerName: string;
  turns: number;
  victoryType: string;
}

function runMatch(
  factory1: PlayerFactory,
  factory2: PlayerFactory,
  name1: string,
  name2: string,
  char1: string,
  char2: string,
): MatchResult {
  resetCardIds();
  const game = new Game({
    playerFactories: [factory1, factory2],
    names: [name1, name2],
    chars: [char1, char2],
  });
  const winner = game.play();
  return {
    winnerName: winner.name,
    turns: game.turncount,
    victoryType: game.victoryType,
  };
}

interface MatchupStats {
  v2Wins: number;
  v1Wins: number;
  total: number;
  totalTurns: number;
  victoryTypes: Record<string, number>;
}

function benchmark(numGamesPerMatchup: number) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
  const results: Record<string, MatchupStats> = {};

  let grandTotalV2 = 0;
  let grandTotalGames = 0;

  console.log(`\nRunning ${numGamesPerMatchup} games per matchup (${numGamesPerMatchup * chars.length * chars.length} total)\n`);
  console.log("Matchup".padEnd(25) + "V2 Win%".padStart(10) + "V2 Wins".padStart(10) + "Avg Turns".padStart(12) + "  Victory Distribution");
  console.log("-".repeat(90));

  for (const c1 of chars) {
    for (const c2 of chars) {
      if (c1 === c2) continue; // skip mirror matchups (same char can't play both)

      const key = `${c1} vs ${c2}`;
      const stats: MatchupStats = {
        v2Wins: 0,
        v1Wins: 0,
        total: 0,
        totalTurns: 0,
        victoryTypes: { M: 0, D: 0, C: 0, T: 0 },
      };

      for (let i = 0; i < numGamesPerMatchup; i++) {
        // Alternate who goes first to eliminate turn-order bias
        const v2First = i % 2 === 0;
        const [f1, f2, n1, n2, ch1, ch2] = v2First
          ? [createTwonkyV2, createTwonky, "V2", "V1", c1, c2]
          : [createTwonky, createTwonkyV2, "V1", "V2", c2, c1];

        try {
          const result = runMatch(f1 as PlayerFactory, f2 as PlayerFactory, n1, n2, ch1, ch2);
          stats.total++;
          stats.totalTurns += result.turns;

          if (result.winnerName === "V2") stats.v2Wins++;
          else stats.v1Wins++;

          if (result.victoryType in stats.victoryTypes) {
            stats.victoryTypes[result.victoryType]++;
          }
        } catch (e) {
          console.error(`  Error in ${key} game ${i}: ${e}`);
        }
      }

      results[key] = stats;
      grandTotalV2 += stats.v2Wins;
      grandTotalGames += stats.total;

      const winPct = stats.total > 0 ? (stats.v2Wins / stats.total * 100).toFixed(1) : "N/A";
      const avgTurns = stats.total > 0 ? (stats.totalTurns / stats.total).toFixed(0) : "N/A";
      const vtDist = Object.entries(stats.victoryTypes)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}:${v}`)
        .join(" ");

      console.log(
        key.padEnd(25) +
        `${winPct}%`.padStart(10) +
        `${stats.v2Wins}/${stats.total}`.padStart(10) +
        `${avgTurns}`.padStart(12) +
        `  ${vtDist}`,
      );
    }
  }

  console.log("-".repeat(90));
  const overallPct = grandTotalGames > 0
    ? (grandTotalV2 / grandTotalGames * 100).toFixed(1)
    : "N/A";
  console.log(`\nOverall: V2 wins ${grandTotalV2}/${grandTotalGames} (${overallPct}%)\n`);

  // Summary by victory type
  const totalVT: Record<string, number> = { M: 0, D: 0, C: 0, T: 0 };
  for (const stats of Object.values(results)) {
    for (const [k, v] of Object.entries(stats.victoryTypes)) {
      totalVT[k] = (totalVT[k] || 0) + v;
    }
  }
  console.log("Victory type distribution:", totalVT);
}

// ── Baseline: V1 vs V1 sanity check ──

function baseline(numGames: number) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
  let p1Wins = 0;
  let total = 0;

  console.log(`\nBaseline: V1 vs V1 (${numGames} games, should be ~50%)\n`);

  for (let i = 0; i < numGames; i++) {
    const c1 = chars[i % chars.length];
    const c2 = chars[(i + 1) % chars.length];
    resetCardIds();
    const game = new Game({
      playerFactories: [createTwonky as PlayerFactory, createTwonky as PlayerFactory],
      names: ["P1", "P2"],
      chars: [c1, c2],
    });
    const winner = game.play();
    total++;
    if (winner.name === "P1") p1Wins++;
  }

  console.log(`P1 wins ${p1Wins}/${total} (${(p1Wins / total * 100).toFixed(1)}%)\n`);
}

// ── CLI entry point ──

const args = process.argv.slice(2);
const mode = args[0] || "benchmark";
const numGames = parseInt(args[1] || args[0] || "20", 10);

if (mode === "baseline") {
  baseline(isNaN(numGames) ? 100 : numGames);
} else {
  benchmark(isNaN(numGames) ? 20 : numGames);
}
