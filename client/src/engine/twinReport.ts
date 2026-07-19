/** Twin-seed report: P(win) trajectories + action lines for both games of a seed. */
import { loadMatches, replayMatch } from "./henryReplayGen";
import { winProbFromFeatures, VALUE_FEATURE_NAMES } from "./valueModel";

const SEED = parseInt(process.argv[2], 10);
const { matches, players } = loadMatches();
const twin = matches.filter((m) => m.seed === SEED).sort((a, b) => +new Date(a.createdAt ?? 0) - +new Date(b.createdAt ?? 0));
const fi = (n: string) => VALUE_FEATURE_NAMES.indexOf(n);
const F_HP = fi("myHealth"), F_OHP = fi("oppHealth"), F_MT = fi("myMissionTotal"), F_OMT = fi("oppMissionTotal");

for (const m of twin) {
  const mps = players.filter((p) => p.matchId === m.id).sort((a, b) => a.playerIndex - b.playerIndex);
  let res = replayMatch(m, mps, false);
  if (!res.ok) res = replayMatch(m, mps, true);
  console.log(`\n=== game ${m.id.slice(0, 8)} | first=p${m.firstPlayerIndex} | p0=${mps[0].character}${mps[0].isBot ? "(bot)" : "(HENRY)"} p1=${mps[1].character}${mps[1].isBot ? "(bot)" : "(HENRY)"} | winner=p${m.winnerIndex} ${m.victoryType} ${m.turnCount}t | replay=${res.ok ? "OK" : res.reason}`);
  if (!res.ok) continue;
  // rows: dual-phase; use phase-0 rows (actor at own turn end)
  const rows = (res.rows as { seat: number; turn: number; feats: number[] }[]);
  for (const seat of [0, 1]) {
    const line = rows.filter((r, i) => r.seat === seat && i % 2 === 0)
      .map((r) => `t${r.turn}:${(100 * winProbFromFeatures(r.feats)).toFixed(0)}%`).join(" ");
    console.log(`  p${seat} ${mps[seat].character}${mps[seat].isBot ? "(bot)" : "(HENRY)"} P(win): ${line}`);
  }
  // per-turn mission/HP from last row of each turn for seat0 perspective
  const s0 = rows.filter((r, i) => r.seat === 0 && i % 2 === 0);
  console.log("  p0-persp missions me/opp: " + s0.map((r) => `t${r.turn}:${Math.round(r.feats[F_MT] * 36)}/${Math.round(r.feats[F_OMT] * 36)}`).join(" "));
  console.log("  p0-persp HP me/opp:       " + s0.map((r) => `t${r.turn}:${Math.round(r.feats[F_HP] * 40)}/${Math.round(r.feats[F_OHP] * 40)}`).join(" "));
  // buys per player from actionLog annotations
  for (const pi of [0, 1] as const) {
    const buys: string[] = [];
    for (const ev of m.actionLog ?? []) {
      if (ev.playerIndex !== pi) continue;
      const ann = (ev as { annotation?: { alternatives?: { description?: string }[]; picked?: unknown } }).annotation;
      const desc = ann?.alternatives?.[0]?.description; // picked action description for bot events
      if (ev.type === "bot_action" && desc && /buy/i.test(desc)) buys.push(`t${ev.turncount}:${desc.replace(/\s*\(.*\)/, "")}`);
    }
    if (buys.length) console.log(`  p${pi} bot buys: ${buys.join(" | ")}`);
  }
}
