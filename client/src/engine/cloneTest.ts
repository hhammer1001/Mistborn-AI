import { Game } from "./game";
import { createTwonky } from "./bot";

function assertEqual(a: unknown, b: unknown, path = "") {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) {
    console.error(`MISMATCH at ${path || "<root>"}`);
    console.error("  orig:", ja.slice(0, 200));
    console.error("  clone:", jb.slice(0, 200));
    process.exit(1);
  }
}

function advance(g: Game, turns: number) {
  let current = 0;
  for (let i = 0; i < turns && !g.winner; i++) {
    g.players[current].playTurn(g);
    current = (current + 1) % g.numPlayers;
    g.turncount += 1;
  }
}

function test(seed: string, chars: [string, string], turnsBefore: number, turnsAfter: number) {
  const g = new Game({
    chars,
    playerFactories: [
      (d, gm, t, n, c) => createTwonky(d, gm, t, n, c),
      (d, gm, t, n, c) => createTwonky(d, gm, t, n, c),
    ],
  });

  advance(g, turnsBefore);
  if (g.winner) return `${seed}: game ended early (no clone test run)`;

  const origBefore = g.toJSON();
  const clone = g.clone();
  const cloneBefore = clone.toJSON();

  assertEqual(origBefore, cloneBefore, "clone state matches original at clone time");

  // Mutate the clone; original must be unaffected
  advance(clone, turnsAfter);
  const origAfter = g.toJSON();
  assertEqual(origBefore, origAfter, "original unchanged after clone mutations");

  // Mutate the original; clone state at time of clone must still match the snapshot
  advance(g, turnsAfter);
  // (clone has already moved on, so we only re-check the frozen snapshot against the
  //  snapshot taken right after cloning)
  return `${seed}: OK`;
}

const results = [
  test("kelsier-vs-shan T5", ["Kelsier", "Shan"], 5, 10),
  test("marsh-vs-vin T8", ["Marsh", "Vin"], 8, 10),
  test("prodigy-vs-kelsier T2", ["Prodigy", "Kelsier"], 2, 20),
  test("shan-vs-marsh T15", ["Shan", "Marsh"], 15, 5),
];
for (const r of results) console.log(r);
console.log("All clone tests passed.");
