/**
 * seekLeakTest.ts — regression test for the lookahead seek-event leak.
 *
 * Bug: gameSnapshot.ts restored deckEvents/pendingKills but not seekEvents, so
 * seeks generated during bot lookahead (lethal solver, chain-lookahead) piled
 * up on game.seekEvents and got dumped into the real activity log on the next
 * committed action's drain — producing huge repeated "Used seek on X" blocks.
 */
import { Game } from "./game";
import { snapshotGame, restoreGame } from "./gameSnapshot";
import { GameSession } from "./session";

let failed = false;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { console.log(`OK ${name}`); }
  else { failed = true; console.error(`FAIL ${name}${detail ? " — " + detail : ""}`); }
}

// ── 1. Unit: restoreGame rolls back seekEvents ──
{
  const g = new Game({
    names: ["A", "B"], chars: ["Marsh", "Vin"],
    testDeck: false, seed: 12345, firstPlayer: 0,
  });
  const snap = snapshotGame(g);
  // Simulate seeks accumulating during a lookahead rollout (the drain that
  // would normally clear these only runs on non-simulating actions).
  const z = { health: 0, damage: 0, money: 0, mission: 0, training: 0 };
  g.seekEvents.push({ playerIndex: 0, cardName: "Ironpull", before: { ...z }, after: { ...z, damage: 2 } });
  g.seekEvents.push({ playerIndex: 0, cardName: "Crash", before: { ...z }, after: { ...z, damage: 2 } });
  check("seekEvents accumulate during sim", g.seekEvents.length === 2);
  restoreGame(g, snap);
  check("restoreGame clears leaked seekEvents", g.seekEvents.length === 0,
    `got ${g.seekEvents.length}`);
}

// ── 2. Integration: full Hulk-vs-Hulk game, no turn leaks a seek wall ──
// The lethal solver runs full 12-deep damage rollouts that seek heavily; pre
// fix those leaked into the committed turn's log. A real turn cannot seek more
// than a handful of times, so any turn with a giant seek count is a leak.
{
  const session = new GameSession({
    players: [
      { kind: "bot_hulk", name: "Hulk A", character: "Marsh" },
      { kind: "bot_hulk", name: "Hulk B", character: "Vin" },
    ],
    firstPlayer: 0,
    seed: 987654,
  });

  check("game reached an end state", session.phase === "game_over");

  const logs = session.getActivityLogs();
  let maxSeekInTurn = 0;
  let worst = "";
  for (let pi = 0; pi < logs.length; pi++) {
    const byTurn = new Map<number, number>();
    for (const e of logs[pi]) {
      if (e.text.startsWith("Used seek on ")) {
        byTurn.set(e.turn, (byTurn.get(e.turn) ?? 0) + 1);
      }
    }
    for (const [turn, n] of byTurn) {
      if (n > maxSeekInTurn) { maxSeekInTurn = n; worst = `player ${pi} turn ${turn}`; }
    }
  }
  // A legitimate turn seeks a single-digit number of times. The leak produced
  // 40-60+ per turn. 20 is a generous ceiling that fails loudly on a leak.
  check("no turn leaks a seek wall", maxSeekInTurn <= 20,
    `max ${maxSeekInTurn} seeks in one turn (${worst})`);
  console.log(`   (max seek lines in any single turn: ${maxSeekInTurn})`);
}

if (failed) { console.error("\nseekLeakTest FAILED"); process.exit(1); }
console.log("\nAll seek-leak tests passed.");
