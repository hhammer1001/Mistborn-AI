/**
 * valueTrain.ts — train the logistic win-probability model on valueDataGen
 * shards. Held-out split is BY GAME (gameKey % 10 === 0) so correlated rows
 * from one game never straddle the split. Reports the trained model against
 * a naive baseline (bias + hpDiff + missionTotalDiff only) — the acceptance
 * gate is a clear win over that baseline on held-out logloss and accuracy.
 *
 * Run:  npx tsx client/src/engine/valueTrain.ts [epochs=4] [lr=0.1] [l2=1e-6]
 * Reads:  client/src/engine/data/value_data/shard_*.csv
 * Writes: client/src/engine/data/value_weights.json (full model)
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { VALUE_FEATURE_NAMES } from "./valueModel";

const EPOCHS = parseInt(process.argv[2] || "4", 10);
const LR = parseFloat(process.argv[3] || "0.1");
const L2 = parseFloat(process.argv[4] || "1e-6");

const DIR = new URL("./data/value_data/", import.meta.url).pathname;
const NF = VALUE_FEATURE_NAMES.length;

// Exploitable mid-turn resource features. A lookahead maximizing P(win) can
// farm these with no-op resource conversions (flare everything → +metals
// available; hoard money; etc.) because the model learned them as winner
// CORRELATES, not causes. Masked to 0 at train time; inference keeps the
// full vector (weights for masked features are exactly 0).
const DROP = new Set([
  "metalsAvailable", "burnsLeft", "curMoney", "curBoxings",
  "handActionCards", "handSize", "atium", "curMissionPts",
]);
const DROP_IDX = new Set(VALUE_FEATURE_NAMES.map((n, i) => (DROP.has(n) ? i : -1)).filter((i) => i >= 0));
console.log(`masking ${DROP_IDX.size} exploitable features: ${[...DROP].join(", ")}`);

// ── Load shards into packed arrays ──
const shards = readdirSync(DIR).filter((f) => f.startsWith("shard_") && f.endsWith(".csv"));
if (shards.length === 0) {
  console.error(`No shards in ${DIR}`);
  process.exit(1);
}

let nRows = 0;
const chunks: { feats: Float32Array; labels: Uint8Array; held: Uint8Array; n: number }[] = [];

// Henry-game fine-tuning: HENRY_W=<k> mixes replayed-match rows (see
// henryReplayGen.ts) into training, duplicated k times. Rows have 2 trailing
// metadata cols (isHenry, turn) beyond the standard format. Held-out split
// still by gameKey so whole matches stay out.
const HENRY_W = parseInt(process.env.HENRY_W || "0", 10);
if (HENRY_W > 0) {
  const hf = new URL("./data/value_data_henry/henry.csv", import.meta.url).pathname;
  const lines = readFileSync(hf, "utf8").split("\n");
  const feats: number[] = [];
  const labels: number[] = [];
  const held: number[] = [];
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length !== NF + 4) continue;
    const gameKey = parseInt(parts[0], 10);
    const isHeld = gameKey % 10 === 0 ? 1 : 0;
    const reps = isHeld ? 1 : HENRY_W;
    for (let r = 0; r < reps; r++) {
      labels.push(parts[1] === "1" ? 1 : 0);
      held.push(isHeld);
      for (let j = 0; j < NF; j++) feats.push(DROP_IDX.has(j) ? 0 : parseFloat(parts[j + 2]));
    }
  }
  chunks.push({ feats: Float32Array.from(feats), labels: Uint8Array.from(labels), held: Uint8Array.from(held), n: labels.length });
  nRows += labels.length;
  console.log(`henry rows: ${labels.length} (weight x${HENRY_W}, held-out kept unduplicated)`);
}

for (const f of shards) {
  const lines = readFileSync(DIR + f, "utf8").split("\n");
  const feats = new Float32Array(lines.length * NF);
  const labels = new Uint8Array(lines.length);
  const held = new Uint8Array(lines.length);
  let n = 0;
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length !== NF + 2) continue;
    const gameKey = parseInt(parts[0], 10);
    labels[n] = parts[1] === "1" ? 1 : 0;
    held[n] = gameKey % 10 === 0 ? 1 : 0;
    for (let j = 0; j < NF; j++) feats[n * NF + j] = DROP_IDX.has(j) ? 0 : parseFloat(parts[j + 2]);
    n++;
  }
  chunks.push({ feats, labels, held, n });
  nRows += n;
  console.log(`loaded ${f}: ${n} rows`);
}
console.log(`total: ${nRows} rows from ${shards.length} shards (${NF} features)`);

// Flatten into train/held sets.
let nTrain = 0, nHeld = 0;
for (const c of chunks) for (let i = 0; i < c.n; i++) (c.held[i] ? nHeld++ : nTrain++);
const X = new Float32Array(nTrain * NF);
const Y = new Uint8Array(nTrain);
const XH = new Float32Array(nHeld * NF);
const YH = new Uint8Array(nHeld);
{
  let t = 0, h = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.n; i++) {
      if (c.held[i]) {
        XH.set(c.feats.subarray(i * NF, (i + 1) * NF), h * NF);
        YH[h++] = c.labels[i];
      } else {
        X.set(c.feats.subarray(i * NF, (i + 1) * NF), t * NF);
        Y[t++] = c.labels[i];
      }
    }
  }
}
chunks.length = 0;
console.log(`train=${nTrain} held=${nHeld}`);

// ── SGD logistic ──
function trainModel(activeIdx: number[]): Float64Array {
  const w = new Float64Array(NF);
  const order = new Uint32Array(nTrain);
  for (let i = 0; i < nTrain; i++) order[i] = i;
  let seed = 12345;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  };
  for (let ep = 0; ep < EPOCHS; ep++) {
    // Fisher-Yates shuffle
    for (let i = nTrain - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    const lr = LR / (1 + ep);
    for (let k = 0; k < nTrain; k++) {
      const i = order[k];
      let z = 0;
      for (const j of activeIdx) z += w[j] * X[i * NF + j];
      const p = 1 / (1 + Math.exp(-z));
      const g = p - Y[i];
      for (const j of activeIdx) {
        w[j] -= lr * (g * X[i * NF + j] + L2 * w[j]);
      }
    }
  }
  return w;
}

function evaluate(w: Float64Array, Xe: Float32Array, Ye: Uint8Array, n: number): { logloss: number; acc: number; auc: number } {
  let ll = 0, correct = 0;
  const preds = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = 0;
    for (let j = 0; j < NF; j++) z += w[j] * Xe[i * NF + j];
    const p = 1 / (1 + Math.exp(-z));
    preds[i] = p;
    const y = Ye[i];
    ll -= y ? Math.log(Math.max(p, 1e-12)) : Math.log(Math.max(1 - p, 1e-12));
    if ((p >= 0.5 ? 1 : 0) === y) correct++;
  }
  // AUC via rank statistic
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => preds[a] - preds[b]);
  let rankSum = 0, nPos = 0;
  for (let r = 0; r < n; r++) {
    if (Ye[idx[r]] === 1) { rankSum += r + 1; nPos++; }
  }
  const nNeg = n - nPos;
  const auc = nPos > 0 && nNeg > 0 ? (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : 0.5;
  return { logloss: ll / n, acc: correct / n, auc };
}

// ── MLP (1 hidden layer, ReLU) ──
function trainMlp(hidden: number): { W1: number[][]; b1: number[]; W2: number[]; b2: number } {
  let seed = 777;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  };
  const W1 = new Float64Array(hidden * NF);
  const b1 = new Float64Array(hidden);
  const W2 = new Float64Array(hidden);
  const scale = Math.sqrt(2 / NF);
  for (let i = 0; i < W1.length; i++) W1[i] = (rnd() * 2 - 1) * scale;
  for (let h = 0; h < hidden; h++) W2[h] = (rnd() * 2 - 1) * Math.sqrt(2 / hidden);
  let b2 = 0;

  const order = new Uint32Array(nTrain);
  for (let i = 0; i < nTrain; i++) order[i] = i;
  const act = new Float64Array(hidden);
  for (let ep = 0; ep < EPOCHS; ep++) {
    for (let i = nTrain - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    const lr = (LR * 0.5) / (1 + ep);
    for (let k = 0; k < nTrain; k++) {
      const i = order[k];
      const base = i * NF;
      // forward
      let z = b2;
      for (let h = 0; h < hidden; h++) {
        let a = b1[h];
        const w1o = h * NF;
        for (let j = 0; j < NF; j++) a += W1[w1o + j] * X[base + j];
        act[h] = a > 0 ? a : 0;
        z += W2[h] * act[h];
      }
      const p = 1 / (1 + Math.exp(-z));
      const g = p - Y[i]; // dL/dz
      // backward
      b2 -= lr * g;
      for (let h = 0; h < hidden; h++) {
        const a = act[h];
        const gW2 = g * a;
        if (a > 0) {
          const gh = g * W2[h]; // dL/da (pre-ReLU, given a>0)
          const w1o = h * NF;
          b1[h] -= lr * gh;
          for (let j = 0; j < NF; j++) {
            const x = X[base + j];
            if (x !== 0) W1[w1o + j] -= lr * gh * x;
          }
        }
        W2[h] -= lr * gW2;
      }
    }
  }
  return {
    W1: Array.from({ length: hidden }, (_, h) => Array.from(W1.subarray(h * NF, (h + 1) * NF))),
    b1: Array.from(b1),
    W2: Array.from(W2),
    b2,
  };
}

function evaluateMlp(m: { W1: number[][]; b1: number[]; W2: number[]; b2: number }, Xe: Float32Array, Ye: Uint8Array, n: number): { logloss: number; acc: number; auc: number } {
  const hidden = m.W1.length;
  let ll = 0, correct = 0;
  const preds = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let z = m.b2;
    for (let h = 0; h < hidden; h++) {
      let a = m.b1[h];
      const row = m.W1[h];
      for (let j = 0; j < NF; j++) a += row[j] * Xe[i * NF + j];
      if (a > 0) z += m.W2[h] * a;
    }
    const p = 1 / (1 + Math.exp(-z));
    preds[i] = p;
    const y = Ye[i];
    ll -= y ? Math.log(Math.max(p, 1e-12)) : Math.log(Math.max(1 - p, 1e-12));
    if ((p >= 0.5 ? 1 : 0) === y) correct++;
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => preds[a] - preds[b]);
  let rankSum = 0, nPos = 0;
  for (let r = 0; r < n; r++) if (Ye[idx[r]] === 1) { rankSum += r + 1; nPos++; }
  const nNeg = n - nPos;
  const auc = nPos > 0 && nNeg > 0 ? (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg) : 0.5;
  return { logloss: ll / n, acc: correct / n, auc };
}

const ALL = Array.from({ length: NF }, (_, i) => i);
const BASELINE = [
  VALUE_FEATURE_NAMES.indexOf("bias"),
  VALUE_FEATURE_NAMES.indexOf("hpDiff"),
  VALUE_FEATURE_NAMES.indexOf("missionTotalDiff"),
];

console.log("training baseline (bias + hpDiff + missionTotalDiff)...");
const wBase = trainModel(BASELINE);
const evBase = evaluate(wBase, XH, YH, nHeld);
console.log(`BASELINE held-out: logloss=${evBase.logloss.toFixed(4)} acc=${(evBase.acc * 100).toFixed(2)}% auc=${evBase.auc.toFixed(4)}`);

const HIDDEN = parseInt(process.env.MLP || "0", 10);
const OUT = new URL("./data/value_weights.json", import.meta.url).pathname;

if (HIDDEN > 0) {
  console.log(`training MLP (hidden=${HIDDEN})...`);
  const mlp = trainMlp(HIDDEN);
  const evTrain = evaluateMlp(mlp, X, Y, Math.min(nTrain, nHeld * 3));
  const evFull = evaluateMlp(mlp, XH, YH, nHeld);
  console.log(`MLP train:    logloss=${evTrain.logloss.toFixed(4)} acc=${(evTrain.acc * 100).toFixed(2)}%`);
  console.log(`MLP held-out: logloss=${evFull.logloss.toFixed(4)} acc=${(evFull.acc * 100).toFixed(2)}% auc=${evFull.auc.toFixed(4)}`);
  writeFileSync(OUT, JSON.stringify({
    features: VALUE_FEATURE_NAMES,
    weights: null,
    mlp,
    heldOut: { logloss: evFull.logloss, acc: evFull.acc, auc: evFull.auc, n: nHeld },
    baseline: { logloss: evBase.logloss, acc: evBase.acc, auc: evBase.auc },
    trainRows: nTrain, hidden: HIDDEN,
  }));
  console.log(`wrote ${OUT}`);
} else {
  console.log("training full model...");
  const wFull = trainModel(ALL);
  const evTrain = evaluate(wFull, X, Y, Math.min(nTrain, nHeld * 3));
  const evFull = evaluate(wFull, XH, YH, nHeld);
  console.log(`FULL train:    logloss=${evTrain.logloss.toFixed(4)} acc=${(evTrain.acc * 100).toFixed(2)}%`);
  console.log(`FULL held-out: logloss=${evFull.logloss.toFixed(4)} acc=${(evFull.acc * 100).toFixed(2)}% auc=${evFull.auc.toFixed(4)}`);

  // Top weights for interpretability
  const ranked = VALUE_FEATURE_NAMES
    .map((name, i) => ({ name, w: wFull[i] }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .slice(0, 15);
  console.log("top |weights|:", ranked.map((r) => `${r.name}=${r.w.toFixed(2)}`).join(" "));

  writeFileSync(OUT, JSON.stringify({
    features: VALUE_FEATURE_NAMES,
    weights: Array.from(wFull),
    mlp: null,
    heldOut: { logloss: evFull.logloss, acc: evFull.acc, auc: evFull.auc, n: nHeld },
    baseline: { logloss: evBase.logloss, acc: evBase.acc, auc: evBase.auc },
    trainRows: nTrain,
  }, null, 2));
  console.log(`wrote ${OUT}`);
}
