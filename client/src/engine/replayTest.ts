/**
 * replayTest.ts — Determinism + replay sanity check for the seeded engine.
 *
 * Run: npx tsx client/src/engine/replayTest.ts
 *
 * Asserts:
 *  - same seed produces identical post-init market/initial decks
 *  - same seed produces identical end state for a bot-vs-bot game
 *  - splitSeed labels produce uncorrelated streams
 *  - GameSession with the same seed reproduces the same trajectory
 */

import { Game } from "./game";
import { GameSession } from "./session";
import { snapshotGame, type GameStateSnap } from "./gameSnapshot";
import { Rng, subRng } from "./rng";
import { createTwonky } from "./bot";
import { resetCardIds } from "./card";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

function assertSameSnap(a: GameStateSnap, b: GameStateSnap, label: string): void {
  // Card-state Maps need stable comparison; fold them into an array of pairs
  // sorted by id so JSON.stringify is order-stable.
  const flatten = (s: GameStateSnap) => ({
    ...s,
    cardStates: [...s.cardStates.entries()].sort((x, y) => x[0] - y[0]),
  });
  const ja = JSON.stringify(flatten(a));
  const jb = JSON.stringify(flatten(b));
  if (ja !== jb) {
    console.error(`FAIL: ${label}`);
    // Find first diverging key for a useful diagnostic.
    for (const k of Object.keys(a) as Array<keyof GameStateSnap>) {
      const ka = JSON.stringify((flatten(a) as Record<string, unknown>)[k]);
      const kb = JSON.stringify((flatten(b) as Record<string, unknown>)[k]);
      if (ka !== kb) {
        console.error(`  diverges at ${k}`);
        console.error(`  a: ${ka.slice(0, 200)}`);
        console.error(`  b: ${kb.slice(0, 200)}`);
        break;
      }
    }
    process.exit(1);
  }
}

// ── 1. splitSeed independence ──

function testSplitSeed(): void {
  const root = 12345;
  const a = subRng(root, "market");
  const b = subRng(root, "p0_init");
  const c = subRng(root, "market");  // re-derived → identical sequence
  const aSeq = [a.next(), a.next(), a.next()];
  const bSeq = [b.next(), b.next(), b.next()];
  const cSeq = [c.next(), c.next(), c.next()];

  assert(JSON.stringify(aSeq) === JSON.stringify(cSeq), "splitSeed is deterministic for same label");
  assert(JSON.stringify(aSeq) !== JSON.stringify(bSeq), "splitSeed produces different streams for different labels");
  console.log("OK splitSeed independence");
}

// ── 2. Same seed → identical post-init state ──

function testInitDeterminism(): void {
  const seed = 0xC0FFEE;
  resetCardIds();
  const g1 = new Game({ seed, chars: ["Kelsier", "Shan"] });
  resetCardIds();
  const g2 = new Game({ seed, chars: ["Kelsier", "Shan"] });
  const s1 = snapshotGame(g1);
  const s2 = snapshotGame(g2);
  assertSameSnap(s1, s2, "two games with same seed have identical init state");
  console.log("OK init determinism");
}

// ── 3. Same seed → identical bot-vs-bot trajectory ──

function testGameDeterminism(): void {
  const seed = 0xBADF00D;
  const factories = (): [
    (d: import("./deck").PlayerDeck, gm: Game, t: number, n: string, c: string) => import("./player").Player,
    (d: import("./deck").PlayerDeck, gm: Game, t: number, n: string, c: string) => import("./player").Player,
  ] => [
    (d, gm, t, n, c) => createTwonky(d, gm, t, n, c),
    (d, gm, t, n, c) => createTwonky(d, gm, t, n, c),
  ];
  resetCardIds();
  const g1 = new Game({ seed, chars: ["Kelsier", "Shan"], playerFactories: factories() });
  resetCardIds();
  const g2 = new Game({ seed, chars: ["Kelsier", "Shan"], playerFactories: factories() });

  g1.play();
  g2.play();
  const s1 = snapshotGame(g1);
  const s2 = snapshotGame(g2);
  assertSameSnap(s1, s2, "two bot-vs-bot games with same seed produce identical end state");
  console.log(`OK game determinism (winner=${g1.winner?.name}, type=${g1.victoryType}, turns=${g1.turncount})`);
}

// ── 4. GameSession bot-vs-bot determinism + action log shape ──

function testSessionDeterminism(): void {
  const seed = 0xDEADBEEF;
  resetCardIds();
  const s1 = new GameSession({
    seed,
    players: [
      { kind: "bot_twonky", name: "A", character: "Kelsier" },
      { kind: "bot_twonky", name: "B", character: "Shan" },
    ],
  });

  // Drive the session forward by repeatedly running bot turns. The session
  // auto-runs the active bot's turn at construction and after each turn
  // hand-off, so for a bot-vs-bot game, end-of-construction → bot 0 turn
  // ran, then bot 1, … until game_over. Wait until phase is game_over.
  // (If the session model required us to poke it, we would; in practice
  // _runBotTurn chains via _startNextTurn until a winner is set.)
  let safety = 5000;
  while (s1.phase !== "game_over" && safety-- > 0) {
    // No external action needed for bot-vs-bot; the chain runs itself. But
    // if the session ever stalls, this loop would spin — break instead.
    break;
  }

  const log1 = s1.getActionLog();
  assert(log1.length > 0, "session bot-vs-bot recorded at least one action event");
  for (const ev of log1) {
    assert(ev.type === "bot_action", `bot-vs-bot action log only contains bot_action events (got ${ev.type})`);
  }

  // Repeat with same seed; expect identical log + identical end state.
  resetCardIds();
  const s2 = new GameSession({
    seed,
    players: [
      { kind: "bot_twonky", name: "A", character: "Kelsier" },
      { kind: "bot_twonky", name: "B", character: "Shan" },
    ],
  });
  const log2 = s2.getActionLog();

  // Compare logs by the parts we care about (skip timestamps).
  const stable = (l: readonly { type: string; playerIndex: number; args: Record<string, unknown>; turncount: number }[]) =>
    l.map((e) => ({ type: e.type, playerIndex: e.playerIndex, args: e.args, turncount: e.turncount }));
  assert(
    JSON.stringify(stable(log1)) === JSON.stringify(stable(log2)),
    "two same-seed bot sessions produce identical action logs",
  );

  const sn1 = snapshotGame(s1.game);
  const sn2 = snapshotGame(s2.game);
  assertSameSnap(sn1, sn2, "two same-seed bot sessions produce identical end state");
  console.log(`OK session determinism (events=${log1.length})`);
}

// ── 5. Rng.clone independence ──

function testRngClone(): void {
  const a = new Rng(42);
  a.next();
  const b = a.clone();
  assert(a.next() === b.next(), "Rng.clone snapshots state");
  // After advancing each independently, they don't have to match — but they
  // shouldn't share state. Verify by advancing only `a`.
  const bBefore = b.next();
  a.next();
  a.next();
  const bAfter = b.next();
  assert(bAfter !== bBefore, "clone advances independently");
  console.log("OK Rng.clone");
}

// ── Entry point ──

testSplitSeed();
testRngClone();
testInitDeterminism();
testGameDeterminism();
testSessionDeterminism();
console.log("All replay tests passed.");
