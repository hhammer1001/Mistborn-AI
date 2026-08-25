/**
 * valueModel.ts — learned win-probability model: state featurizer + logistic
 * inference. The featurizer maps (mover, game) to a fixed-length vector of
 * engineered features, all pre-normalized to roughly [0, 1.5]; the model is
 * a logistic regression over those features trained by valueTrain.ts on
 * (state, final outcome) pairs from self-play (valueDataGen.ts).
 *
 * Perspective rule: features are always computed from the ACTING player's
 * point of view mid-turn, using only information observable to that player
 * (opp deck composition counts are derivable from public buys/eliminations;
 * opp hand contents are never read).
 *
 * Used as the lookahead LEAF EVALUATION in AnvilSecondBot ("value leaf"):
 * candidate actions are compared by P(win) of the simulated post-action
 * state, replacing the heuristic follow-up chain. This fixes the scale
 * mismatch that killed the earlier naive state-value lookahead attempt
 * (BOT_NOTES: heuristic action-scores are not state values).
 */

import type { Game } from "./game";
import type { Player } from "./player";
import { Action, Funding } from "./card";
import weightsJson from "./data/value_weights.json";

import { CHARACTERS } from "./types";
const CHARS = [...CHARACTERS]; // full roster incl. expansion characters
const DAMAGE_ENGINE_CARDS = new Set(["House War", "Crushing Blow", "Maelstrom", "Ruin"]);
const MISSION_ENGINE_CARDS = new Set(["Pierce", "Unveil", "Pursue", "Hyperaware", "Strategize"]);

export const VALUE_FEATURE_NAMES: string[] = [
  "bias",
  "myHealth", "oppHealth", "hpDiff", "oppLethalRange", "myDangerRange",
  "turnCount", "movesSecond",
  "training", "oppTraining", "trainingDiff",
  "atium", "curMoney", "curBoxings", "curDamage", "curMissionPts",
  "pDamage", "pMoney", "permDraw",
  "metalsAvailable", "burnsLeft", "handActionCards", "handSize",
  "deckSize", "oppDeckSize", "fundingCount", "oppFundingCount",
  "missionEngines", "damageEngines", "oppMissionEngines", "oppDamageEngines",
  "myMissionTotal", "oppMissionTotal", "missionTotalDiff",
  "myMissionMin", "oppMissionMin", "myMissionMax", "oppMissionMax",
  "myCompleted", "oppCompleted", "completedDiff",
  "missionsILead", "myClosing", "oppClosing",
  "myAlliesInPlay", "myAllyHP", "myDefenderHP",
  "oppAlliesInPlay", "oppAllyHP", "oppDefenderHP",
  ...CHARS.map((c) => "char" + c),
  ...CHARS.map((c) => "oppChar" + c),
  "postOppTurn",
  // v3: mission threshold proximity — the dimension of Henry's mission
  // selection the model previously couldn't see (divergence runs 1+3).
  "myMinTierGap", "oppMinTierGap", "myFirstRewardNear", "oppFirstRewardNear",
];

/** postOppTurn: 0 = my turn just ended (opp about to move); 1 = the
 * opponent's reply has resolved (I'm about to move). Same underlying game
 * moment produces one row of each phase from the two perspectives. */
export function featurize(player: Player, game: Game, postOppTurn: 0 | 1 = 0): number[] {
  const opp = game.players[(player.turnOrder + 1) % 2];

  const own = [...player.deck.hand, ...player.deck.discard, ...player.deck.cards];
  const oppOwn = [...opp.deck.hand, ...opp.deck.discard, ...opp.deck.cards];
  const count = (cards: { name: string }[], set: Set<string>) => cards.filter((c) => set.has(c.name)).length;

  let myTotal = 0, oppTotal = 0, myMin = 12, oppMin = 12, myMax = 0, oppMax = 0;
  let myCompleted = 0, oppCompleted = 0, iLead = 0;
  let myTierGap = 6, oppTierGap = 6; // distance to nearest uncrossed tier threshold (capped)
  let myFirstNear = 0, oppFirstNear = 0; // a first-to-tier bonus within 3 points
  for (const m of game.missions) {
    const mr = m.playerRanks[player.turnOrder];
    const or = m.playerRanks[opp.turnOrder];
    myTotal += mr; oppTotal += or;
    myMin = Math.min(myMin, mr); oppMin = Math.min(oppMin, or);
    myMax = Math.max(myMax, mr); oppMax = Math.max(oppMax, or);
    if (mr >= 12) myCompleted++;
    if (or >= 12) oppCompleted++;
    if (mr > or) iLead++;
    const top = Math.max(mr, or);
    for (const t of m.tiers) {
      if (mr < t.threshold) {
        myTierGap = Math.min(myTierGap, t.threshold - mr);
        if (top < t.threshold && t.threshold - mr <= 3) myFirstNear = 1;
      }
      if (or < t.threshold) {
        oppTierGap = Math.min(oppTierGap, t.threshold - or);
        if (top < t.threshold && t.threshold - or <= 3) oppFirstNear = 1;
      }
    }
  }

  const allyHP = (p: Player) => p.allies.reduce((s, a) => s + a.health, 0);
  const defHP = (p: Player) => p.allies.reduce((s, a) => s + (a.defender ? a.health : 0), 0);
  const handActions = player.deck.hand.filter((c) => c instanceof Action).length;
  const metalsAvail = player.metalAvailable.reduce((s, m) => s + (m > 0 ? 1 : 0), 0);

  return [
    1,
    player.curHealth / 40, opp.curHealth / 40, (player.curHealth - opp.curHealth) / 40,
    opp.curHealth <= 14 ? 1 : 0, player.curHealth <= 14 ? 1 : 0,
    game.turncount / 30, player.turnOrder === game.firstPlayer ? 0 : 1,
    player.training / 16, opp.training / 16, (player.training - opp.training) / 16,
    player.atium / 3, player.curMoney / 10, player.curBoxings / 5, player.curDamage / 10, player.curMission / 5,
    player.pDamage / 3, player.pMoney / 3, (player.handSize - 5) / 2,
    metalsAvail / 8, player.burns / 2, handActions / 5, player.deck.hand.length / 6,
    own.length / 20, oppOwn.length / 20,
    own.filter((c) => c instanceof Funding).length / 6, oppOwn.filter((c) => c instanceof Funding).length / 6,
    count(own, MISSION_ENGINE_CARDS) / 3, count(own, DAMAGE_ENGINE_CARDS) / 3,
    count(oppOwn, MISSION_ENGINE_CARDS) / 3, count(oppOwn, DAMAGE_ENGINE_CARDS) / 3,
    myTotal / 36, oppTotal / 36, (myTotal - oppTotal) / 36,
    myMin / 12, oppMin / 12, myMax / 12, oppMax / 12,
    myCompleted / 3, oppCompleted / 3, (myCompleted - oppCompleted) / 3,
    iLead / 3, myMin >= 8 ? 1 : 0, oppMin >= 8 ? 1 : 0,
    player.allies.length / 4, allyHP(player) / 10, defHP(player) / 6,
    opp.allies.length / 4, allyHP(opp) / 10, defHP(opp) / 6,
    ...CHARS.map((c) => (player.character === c ? 1 : 0)),
    ...CHARS.map((c) => (opp.character === c ? 1 : 0)),
    postOppTurn,
    Math.min(myTierGap, 6) / 6, Math.min(oppTierGap, 6) / 6,
    myFirstNear, oppFirstNear,
  ];
}

// ── Inference ──
// Two model shapes share the weights file: plain logistic ({weights}) and a
// 1-hidden-layer MLP ({mlp: {W1, b1, W2, b2}}, ReLU hidden, sigmoid out).

export interface MlpWeights {
  W1: number[][]; // [hidden][in]
  b1: number[];
  W2: number[]; // [hidden]
  b2: number;
}

interface ValueWeights {
  features: string[];
  weights?: number[] | null;
  mlp?: MlpWeights | null;
}

let W: number[] | null = (weightsJson as ValueWeights).weights ?? null;
let MLP: MlpWeights | null = (weightsJson as ValueWeights).mlp ?? null;

/** Swap weights at runtime (training/eval harnesses). */
export function setValueWeights(weights: number[] | null, mlp: MlpWeights | null = null): void {
  W = weights;
  MLP = mlp;
}

export function valueModelAvailable(): boolean {
  if (MLP !== null) return MLP.W1[0]?.length === VALUE_FEATURE_NAMES.length;
  return W !== null && W.length === VALUE_FEATURE_NAMES.length;
}

export function winProbFromFeatures(f: number[]): number {
  if (MLP) {
    const { W1, b1, W2, b2 } = MLP;
    let z = b2;
    for (let h = 0; h < W1.length; h++) {
      let a = b1[h];
      const row = W1[h];
      for (let i = 0; i < row.length; i++) a += row[i] * f[i];
      if (a > 0) z += W2[h] * a; // ReLU
    }
    return 1 / (1 + Math.exp(-z));
  }
  const w = W!;
  let z = 0;
  for (let i = 0; i < w.length; i++) z += w[i] * f[i];
  return 1 / (1 + Math.exp(-z));
}

/** P(mover wins) for the current state. Caller must check
 * valueModelAvailable() first. */
export function winProb(player: Player, game: Game, postOppTurn: 0 | 1 = 0): number {
  return winProbFromFeatures(featurize(player, game, postOppTurn));
}
