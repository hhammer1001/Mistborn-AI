/**
 * benchmark.ts — Bot-vs-bot test harness.
 * Run with: npx tsx client/src/engine/benchmark.ts [numGames]
 *
 * Tests Squash Bot vs Twonky V1 across all character matchups.
 */

import { Game, type PlayerFactory } from "./game";
import { createTwonky } from "./bot";
import { createSquashBot } from "./squashBot";
import { createZoomBot } from "./zoomBot";
import { createSquashV2Bot } from "./squashV2Bot";
import { createSynergyBotPrime } from "./synergyBot";
import { resetCardIds } from "./card";

type BotName = "V1" | "Squash" | "Zoom" | "SquashV2" | "Synergy";
const BOT_FACTORIES: Record<BotName, PlayerFactory> = {
  V1: createTwonky as PlayerFactory,
  Squash: createSquashBot as PlayerFactory,
  Zoom: createZoomBot as PlayerFactory,
  SquashV2: createSquashV2Bot as PlayerFactory,
  Synergy: createSynergyBotPrime as PlayerFactory,
};

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
  squashWins: number;
  v1Wins: number;
  total: number;
  totalTurns: number;
  victoryTypes: Record<string, number>;
}

function benchmark(numGamesPerMatchup: number) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
  const results: Record<string, MatchupStats> = {};

  let grandTotalSquash = 0;
  let grandTotalGames = 0;

  console.log(`\nRunning ${numGamesPerMatchup} games per matchup (${numGamesPerMatchup * chars.length * chars.length} total)\n`);
  console.log("Matchup".padEnd(25) + "Squash Win%".padStart(13) + "Squash Wins".padStart(13) + "Avg Turns".padStart(12) + "  Victory Distribution");
  console.log("-".repeat(95));

  for (const c1 of chars) {
    for (const c2 of chars) {
      if (c1 === c2) continue; // skip mirror matchups (same char can't play both)

      const key = `${c1} vs ${c2}`;
      const stats: MatchupStats = {
        squashWins: 0,
        v1Wins: 0,
        total: 0,
        totalTurns: 0,
        victoryTypes: { M: 0, D: 0, C: 0, T: 0 },
      };

      for (let i = 0; i < numGamesPerMatchup; i++) {
        // Alternate who goes first to eliminate turn-order bias
        const squashFirst = i % 2 === 0;
        const [f1, f2, n1, n2, ch1, ch2] = squashFirst
          ? [createSquashBot, createTwonky, "Squash", "V1", c1, c2]
          : [createTwonky, createSquashBot, "V1", "Squash", c2, c1];

        try {
          const result = runMatch(f1 as PlayerFactory, f2 as PlayerFactory, n1, n2, ch1, ch2);
          stats.total++;
          stats.totalTurns += result.turns;

          if (result.winnerName === "Squash") stats.squashWins++;
          else stats.v1Wins++;

          if (result.victoryType in stats.victoryTypes) {
            stats.victoryTypes[result.victoryType]++;
          }
        } catch (e) {
          console.error(`  Error in ${key} game ${i}: ${e}`);
        }
      }

      results[key] = stats;
      grandTotalSquash += stats.squashWins;
      grandTotalGames += stats.total;

      const winPct = stats.total > 0 ? (stats.squashWins / stats.total * 100).toFixed(1) : "N/A";
      const avgTurns = stats.total > 0 ? (stats.totalTurns / stats.total).toFixed(0) : "N/A";
      const vtDist = Object.entries(stats.victoryTypes)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}:${v}`)
        .join(" ");

      console.log(
        key.padEnd(25) +
        `${winPct}%`.padStart(13) +
        `${stats.squashWins}/${stats.total}`.padStart(13) +
        `${avgTurns}`.padStart(12) +
        `  ${vtDist}`,
      );
    }
  }

  console.log("-".repeat(95));
  const overallPct = grandTotalGames > 0
    ? (grandTotalSquash / grandTotalGames * 100).toFixed(1)
    : "N/A";
  console.log(`\nOverall: Squash wins ${grandTotalSquash}/${grandTotalGames} (${overallPct}%)\n`);

  // Summary by victory type
  const totalVT: Record<string, number> = { M: 0, D: 0, C: 0, T: 0 };
  for (const stats of Object.values(results)) {
    for (const [k, v] of Object.entries(stats.victoryTypes)) {
      totalVT[k] = (totalVT[k] || 0) + v;
    }
  }
  console.log("Victory type distribution:", totalVT);
}

// ── Generic matchup (any bot vs any bot) ──

function matchup(botA: BotName, botB: BotName, numGamesPerMatchup: number) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
  const fA = BOT_FACTORIES[botA];
  const fB = BOT_FACTORIES[botB];

  let totalAWins = 0;
  let totalGames = 0;
  const vt: Record<string, number> = { M: 0, D: 0, C: 0, T: 0 };

  console.log(`\n${botA} vs ${botB} — ${numGamesPerMatchup} games per matchup (${numGamesPerMatchup * chars.length * (chars.length - 1)} total)\n`);
  console.log("Matchup".padEnd(25) + `${botA} Win%`.padStart(12) + `${botA} Wins`.padStart(12) + "Avg Turns".padStart(12) + "  Victory Distribution");
  console.log("-".repeat(95));

  for (const c1 of chars) {
    for (const c2 of chars) {
      if (c1 === c2) continue;

      let aWins = 0;
      let total = 0;
      let totalTurns = 0;
      const mVt: Record<string, number> = { M: 0, D: 0, C: 0, T: 0 };

      for (let i = 0; i < numGamesPerMatchup; i++) {
        const aFirst = i % 2 === 0;
        const [f1, f2, n1, n2, ch1, ch2] = aFirst
          ? [fA, fB, botA, botB, c1, c2]
          : [fB, fA, botB, botA, c2, c1];

        try {
          resetCardIds();
          const game = new Game({
            playerFactories: [f1, f2],
            names: [n1, n2],
            chars: [ch1, ch2],
          });
          const winner = game.play();
          total++;
          totalTurns += game.turncount;
          if (winner.name === botA) aWins++;
          if (game.victoryType in mVt) mVt[game.victoryType]++;
        } catch (e) {
          console.error(`  Error in ${c1} vs ${c2} game ${i}: ${e}`);
          if (e instanceof Error && e.stack) console.error(e.stack.split("\n").slice(0, 15).join("\n"));
        }
      }

      totalAWins += aWins;
      totalGames += total;
      for (const k of Object.keys(vt)) vt[k] += mVt[k];

      const winPct = total > 0 ? (aWins / total * 100).toFixed(1) : "N/A";
      const avgTurns = total > 0 ? (totalTurns / total).toFixed(0) : "N/A";
      const vtDist = Object.entries(mVt).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(" ");

      console.log(
        `${c1} vs ${c2}`.padEnd(25) +
        `${winPct}%`.padStart(12) +
        `${aWins}/${total}`.padStart(12) +
        `${avgTurns}`.padStart(12) +
        `  ${vtDist}`,
      );
    }
  }

  console.log("-".repeat(95));
  const overallPct = totalGames > 0 ? (totalAWins / totalGames * 100).toFixed(1) : "N/A";
  console.log(`\n${botA} vs ${botB} overall: ${totalAWins}/${totalGames} (${overallPct}%)`);
  console.log("Victory type distribution:", vt, "\n");
  return { botA, botB, wins: totalAWins, total: totalGames, pct: overallPct };
}

// ── Zoom going-second specialist benchmark ──
// Zoom is trained to specialize in the second-player seat. This pins Zoom to
// seat 2 every game (no alternation) and runs it against the named opponent
// in seat 1, across all asymmetric character pairings. Reports how well
// Zoom-going-second performs against the chosen opponent-going-first.

function zoomSecondSeatBench(
  opponent: BotName,
  numGamesPerMatchup: number,
  secondSeatBot: BotName = "Zoom",
) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
  const fOpp = BOT_FACTORIES[opponent];
  const fSecond = BOT_FACTORIES[secondSeatBot];

  let totalSecondWins = 0;
  let totalGames = 0;
  const vt: Record<string, number> = { M: 0, D: 0, C: 0, T: 0 };

  console.log(`\n${secondSeatBot} (going second) vs ${opponent} (going first) — ${numGamesPerMatchup} games per matchup`);
  console.log(`(${numGamesPerMatchup * chars.length * (chars.length - 1)} total)\n`);
  console.log("Matchup".padEnd(25) + `${secondSeatBot} Win%`.padStart(12) + `${secondSeatBot} Wins`.padStart(13) + "Avg Turns".padStart(12) + "  Victory Distribution");
  console.log("-".repeat(95));

  for (const cFirst of chars) {
    for (const cSecond of chars) {
      if (cFirst === cSecond) continue;

      let wins = 0;
      let total = 0;
      let totalTurns = 0;
      const mVt: Record<string, number> = { M: 0, D: 0, C: 0, T: 0 };

      for (let i = 0; i < numGamesPerMatchup; i++) {
        try {
          resetCardIds();
          const game = new Game({
            playerFactories: [fOpp, fSecond],
            names: [opponent, secondSeatBot],
            chars: [cFirst, cSecond],
          });
          const winner = game.play();
          total++;
          totalTurns += game.turncount;
          if (winner.name === secondSeatBot) wins++;
          if (game.victoryType in mVt) mVt[game.victoryType]++;
        } catch (e) {
          console.error(`  Error in ${cFirst} vs ${cSecond} game ${i}: ${e}`);
        }
      }

      totalSecondWins += wins;
      totalGames += total;
      for (const k of Object.keys(vt)) vt[k] += mVt[k];

      const winPct = total > 0 ? (wins / total * 100).toFixed(1) : "N/A";
      const avgTurns = total > 0 ? (totalTurns / total).toFixed(0) : "N/A";
      const vtDist = Object.entries(mVt).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(" ");

      console.log(
        `${cFirst} vs ${cSecond}`.padEnd(25) +
        `${winPct}%`.padStart(12) +
        `${wins}/${total}`.padStart(13) +
        `${avgTurns}`.padStart(12) +
        `  ${vtDist}`,
      );
    }
  }

  console.log("-".repeat(95));
  const overallPct = totalGames > 0 ? (totalSecondWins / totalGames * 100).toFixed(1) : "N/A";
  console.log(`\n${secondSeatBot} (going second) vs ${opponent} (going first) overall: ${totalSecondWins}/${totalGames} (${overallPct}%)`);
  console.log("Victory type distribution:", vt, "\n");
}

// ── SquashV2 going-first specialist benchmark ──
// SquashV2 is trained to specialize in seat 0. Pin SquashV2 to seat 0 every
// game and run against the named opponent in seat 1, across all asymmetric
// pairings. Reports SquashV2-going-first win rate against the chosen opp.

function squashV2FirstSeatBench(
  opponent: BotName,
  numGamesPerMatchup: number,
  firstSeatBot: BotName = "SquashV2",
  seedOffset = 0,
) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
  const fOpp = BOT_FACTORIES[opponent];
  const fFirst = BOT_FACTORIES[firstSeatBot];

  let totalFirstWins = 0;
  let totalGames = 0;
  const vt: Record<string, number> = { M: 0, D: 0, C: 0, T: 0 };

  console.log(`\n${firstSeatBot} (going first) vs ${opponent} (going second) — ${numGamesPerMatchup} games per matchup` + (seedOffset > 0 ? ` [seedOffset=${seedOffset}]` : ""));
  console.log(`(${numGamesPerMatchup * chars.length * (chars.length - 1)} total)\n`);
  console.log("Matchup".padEnd(25) + `${firstSeatBot} Win%`.padStart(13) + `${firstSeatBot} Wins`.padStart(14) + "Avg Turns".padStart(12) + "  Victory Distribution");
  console.log("-".repeat(95));

  let matchupIdx = 0;
  for (const cFirst of chars) {
    for (const cSecond of chars) {
      if (cFirst === cSecond) continue;

      let wins = 0;
      let total = 0;
      let totalTurns = 0;
      const mVt: Record<string, number> = { M: 0, D: 0, C: 0, T: 0 };

      for (let i = 0; i < numGamesPerMatchup; i++) {
        try {
          resetCardIds();
          // Deterministic seed when seedOffset > 0: reproducible across runs
          // so different bot configs produce comparable results from same games.
          const seed = seedOffset > 0 ? seedOffset + matchupIdx * 1000003 + i : undefined;
          const game = new Game({
            playerFactories: [fFirst, fOpp],
            names: [firstSeatBot, opponent],
            chars: [cFirst, cSecond],
            seed,
          });
          const winner = game.play();
          total++;
          totalTurns += game.turncount;
          if (winner.name === firstSeatBot) wins++;
          if (game.victoryType in mVt) mVt[game.victoryType]++;
        } catch (e) {
          console.error(`  Error in ${cFirst} vs ${cSecond} game ${i}: ${e}`);
        }
      }
      matchupIdx++;

      totalFirstWins += wins;
      totalGames += total;
      for (const k of Object.keys(vt)) vt[k] += mVt[k];

      const winPct = total > 0 ? (wins / total * 100).toFixed(1) : "N/A";
      const avgTurns = total > 0 ? (totalTurns / total).toFixed(0) : "N/A";
      const vtDist = Object.entries(mVt).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(" ");

      console.log(
        `${cFirst} vs ${cSecond}`.padEnd(25) +
        `${winPct}%`.padStart(13) +
        `${wins}/${total}`.padStart(14) +
        `${avgTurns}`.padStart(12) +
        `  ${vtDist}`,
      );
    }
  }

  console.log("-".repeat(95));
  const overallPct = totalGames > 0 ? (totalFirstWins / totalGames * 100).toFixed(1) : "N/A";
  console.log(`\n${firstSeatBot} (going first) vs ${opponent} (going second) overall: ${totalFirstWins}/${totalGames} (${overallPct}%)`);
  console.log("Victory type distribution:", vt, "\n");
  return { wins: totalFirstWins, total: totalGames, pct: overallPct };
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

if (mode === "baseline") {
  const n = parseInt(args[1] || "100", 10);
  baseline(isNaN(n) ? 100 : n);
} else if (mode === "zoom") {
  // npx tsx benchmark.ts zoom [opponent=Squash] [games=20] [secondSeatBot=Zoom]
  const opp = (args[1] as BotName) || "Squash";
  const n = parseInt(args[2] || "20", 10);
  const second = ((args[3] as BotName) || "Zoom");
  if (!BOT_FACTORIES[opp] || !BOT_FACTORIES[second]) {
    console.error(`Usage: zoom <V1|Squash|Synergy> [games] [V1|Squash|Zoom|Synergy]`);
    process.exit(1);
  }
  zoomSecondSeatBench(opp, isNaN(n) ? 20 : n, second);
} else if (mode === "v2") {
  // npx tsx benchmark.ts v2 [opponent=Zoom] [games=20] [firstSeatBot=SquashV2] [seedOffset=0]
  const opp = (args[1] as BotName) || "Zoom";
  const n = parseInt(args[2] || "20", 10);
  const first = ((args[3] as BotName) || "SquashV2");
  const seedOffset = parseInt(args[4] || "0", 10);
  if (!BOT_FACTORIES[opp] || !BOT_FACTORIES[first]) {
    console.error(`Usage: v2 <V1|Squash|Zoom|Synergy> [games] [SquashV2|Squash|Zoom] [seedOffset]`);
    process.exit(1);
  }
  // Apply combo_v5_all50 settings before benching (so v2 uses tuned config).
  if (process.argv.includes("--with-tunings")) {
    const { SquashV2Config, recomputeSquashV2Ratings, recomputeSquashV2VsOppLifts } = require("./squashBotEval");
    const { SquashV2Bot } = require("./squashV2Bot");
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    void SquashV2Bot; void recomputeSquashV2Ratings; void recomputeSquashV2VsOppLifts;
  }
  squashV2FirstSeatBench(opp, isNaN(n) ? 20 : n, first, isNaN(seedOffset) ? 0 : seedOffset);
} else if (mode === "synergy") {
  const n = parseInt(args[1] || "20", 10);
  const games = isNaN(n) ? 20 : n;
  const r1 = matchup("Synergy", "V1", games);
  const r2 = matchup("Synergy", "V2", games);
  console.log("\n=== Summary ===");
  console.log(`Synergy vs V1:  ${r1.wins}/${r1.total} (${r1.pct}%)`);
  console.log(`Synergy vs V2:  ${r2.wins}/${r2.total} (${r2.pct}%)`);
} else if (mode === "matchup") {
  const a = args[1] as BotName;
  const b = args[2] as BotName;
  const n = parseInt(args[3] || "20", 10);
  if (!BOT_FACTORIES[a] || !BOT_FACTORIES[b]) {
    console.error(`Usage: matchup <V1|V2|Synergy> <V1|V2|Synergy> [games]`);
    process.exit(1);
  }
  matchup(a, b, isNaN(n) ? 20 : n);
} else {
  const n = parseInt(args[1] || args[0] || "20", 10);
  benchmark(isNaN(n) ? 20 : n);
}
