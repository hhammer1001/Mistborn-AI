/**
 * Bot-vs-bot test script.
 * Run with: npx tsx client/src/engine/test_bot.ts
 */
import { Game } from "./game";
import { createTwonky } from "./bot";
import { resetCardIds } from "./card";

const NUM_GAMES = 10;
const results: { winner: string; turns: number; victory: string }[] = [];

for (let i = 0; i < NUM_GAMES; i++) {
  resetCardIds();
  const game = new Game({
    names: ["Twonky A", "Twonky B"],
    chars: ["Kelsier", "Shan"],
    playerFactories: [createTwonky, createTwonky],
  });

  try {
    const winner = game.play();
    results.push({
      winner: winner.name,
      turns: game.turncount,
      victory: game.victoryType,
    });
    console.log(`Game ${i + 1}: ${winner.name} wins in ${game.turncount} turns (${game.victoryType})`);
  } catch (e) {
    console.error(`Game ${i + 1}: ERROR -`, e);
    results.push({ winner: "ERROR", turns: game.turncount, victory: "E" });
  }
}

console.log("\n=== Summary ===");
const wins: Record<string, number> = {};
for (const r of results) {
  wins[r.winner] = (wins[r.winner] ?? 0) + 1;
}
console.log("Wins:", wins);
console.log("Avg turns:", Math.round(results.reduce((s, r) => s + r.turns, 0) / results.length));
console.log("Victory types:", results.map((r) => r.victory).join(", "));

const errors = results.filter((r) => r.winner === "ERROR").length;
if (errors > 0) {
  console.error(`\n${errors} game(s) failed!`);
  process.exit(1);
} else {
  console.log("\nAll games completed successfully!");
}
