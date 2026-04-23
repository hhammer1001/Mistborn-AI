import type { Game } from "./game";
import type { Player } from "./player";
import { Action, Ally, Funding, Card } from "./card";

// ── Base effect values (per unit amount) ──

const EFFECT_VALUE: Record<string, number> = {
  D: 1.0,
  M: 1.0,
  H: 0.5,
  Mi: 3.5,
  C: 2.5,
  T: 3.0,
  E: 2.0,
  A: 2.5,
  B: 3.0,
  K: 3.0,
  R: 1.5,
  pull: 1.5,
  push: 1.0,
  riot: 2.0,
  seek: 2.0,
  Pc: 10.0,
  Pd: 8.0,
  Pm: 7.0,
  special1: 1.5,
  special2: 2.0,
  special3: 2.0,
  special4: 3.0,
  special5: 1.5,
  special6: 1.0,
  special7: 1.0,
  special8: 3.0,
  special9: 2.5,
  special10: 3.0,
  special11: 6.0,
  special12: 2.0,
  special13: 50.0,
  special14: 1.0,
  special15: 1.5,
  special16: 2.5,
};

function evalEffect(effect: string | undefined, amount: string | undefined): number {
  if (!effect) return 0;
  const effs = effect.split(".");
  const amts = (amount ?? "").split(".");
  let total = 0;
  for (let i = 0; i < effs.length; i++) {
    const e = effs[i];
    if (e === "choose") continue;
    const n = parseInt(amts[i] ?? "0", 10);
    const v = EFFECT_VALUE[e];
    if (v === undefined) continue;
    total += Math.abs(n) * v;
  }
  return total;
}

function cardValue(card: Card): number {
  if (card instanceof Funding) return 1.0;
  if (card instanceof Action) {
    // Sum of the ability tiers the card can deliver (first tier = guaranteed,
    // higher tiers need metal unlocks — discount them).
    const d = card.data;
    const ab1 = evalEffect(d[3], d[4]);
    const ab2 = evalEffect(d[5], d[6]) * 0.6;
    const ab3 = evalEffect(d[7], d[8]) * 0.3;
    const burn = evalEffect(d[11], d[12]) * 0.3;
    return ab1 + ab2 + ab3 + burn;
  }
  if (card instanceof Ally) {
    const d = card.data;
    const ab1 = evalEffect(d[3], d[4]);
    const ab2 = evalEffect(d[5], d[6]) * 0.6;
    const defenderBonus = card.defender ? card.health * 2.5 : 0;
    // Allies stay in play — their ongoing availability is more valuable than
    // a one-shot action card of equivalent effect. Small multiplier.
    return (ab1 + ab2) * 1.2 + defenderBonus;
  }
  return 0;
}

function allDeckCards(player: Player): Card[] {
  return [...player.deck.hand, ...player.deck.cards, ...player.deck.discard, ...player.deck.setAside];
}

/** Expected economic output per draw × handSize, scaled by cycle rate. */
function deckQuality(player: Player): number {
  const cards = allDeckCards(player);
  if (cards.length === 0) return 0;
  const total = cards.reduce((s, c) => s + cardValue(c), 0);
  const avgPerCard = total / cards.length;
  // Per-turn expected value: draw handSize cards, each worth avgPerCard.
  return avgPerCard * player.handSize;
}

function defenderHP(player: Player): number {
  return player.allies.filter((a) => a.defender).reduce((s, a) => s + a.health, 0);
}

function allyOngoingValue(player: Player): number {
  // Allies still in play contribute per-turn value independent of deck draws.
  // (They don't cycle through the deck, so they're not counted in deckQuality.)
  return player.allies.reduce((s, a) => s + cardValue(a), 0);
}

function missionProgressScore(game: Game, playerIdx: number): number {
  let score = 0;
  let completed = 0;
  for (const m of game.missions) {
    const rank = m.playerRanks[playerIdx];
    // Steep curve near 12: rank-11 is one advance from completing, rank-12 is
    // 1/3 of the way to winning. Reward accordingly.
    if (rank >= 12) {
      score += 100;
      completed += 1;
    } else if (rank === 11) {
      score += 70;
    } else if (rank === 10) {
      score += 55;
    } else if (rank >= 8) {
      score += rank * 5.0;     // 8→40, 9→45
    } else if (rank >= 4) {
      score += rank * 4.0;     // 4→16, 7→28
    } else {
      score += rank * 3.0;
    }
  }
  if (completed === 2) score += 80;  // 2/3 done — racing to win
  return score;
}

function deckBloatPenalty(player: Player): number {
  const size = allDeckCards(player).length + player.allies.length;
  // Beyond 15 cards, extra ones cycle too slowly to see. Sharper penalty at 18+.
  if (size <= 12) return 0;
  if (size <= 15) return (size - 12) * 1.5;
  if (size <= 18) return 4.5 + (size - 15) * 3.0;
  return 13.5 + (size - 18) * 5.0;
}

// ── Weights (v1, hand-tuned) ──

const W_HP = 1.0;                 // each HP of lead
const W_MISSION = 1.0;            // scaled inside missionProgressScore
const W_DECK_QUALITY = 4.0;       // engine strength per player
const W_ALLIES_ONGOING = 1.5;     // value of allies in play (beyond deck quality)
const W_TRAINING = 0.8;           // training level
const W_ATIUM = 2.0;              // atium stored
const W_PMONEY = 2.5;             // permanent money per turn (compounds)
const W_PDAMAGE = 3.0;            // permanent damage per turn
const W_DEFENDERS = 1.0;          // sum of defender HP (blocks damage)
const W_CUR_MISSION_CARRY = 0.0;  // curMission resets at end_actions (no value)
const W_CUR_MONEY_CARRY = 0.0;    // curMoney resets at end_actions (no value)
const W_CUR_BOXINGS = 1.2;        // boxings persist; 2 boxings = 1 extra buy
const W_DECK_BLOAT = 1.0;
const TERMINAL_WIN = 10000;

/** Evaluate the state from `me`'s perspective. Higher = better for me.
 *  Expected to be called after a simulated turn (end_actions + damage phase).
 */
export function evaluateState(game: Game, me: Player): number {
  if (game.winner === me) return TERMINAL_WIN;
  if (game.winner && game.winner !== me) return -TERMINAL_WIN;

  const opp = game.players[(me.turnOrder + 1) % game.numPlayers];

  const myScore =
    W_HP * me.curHealth +
    W_MISSION * missionProgressScore(game, me.turnOrder) +
    W_DECK_QUALITY * deckQuality(me) +
    W_ALLIES_ONGOING * allyOngoingValue(me) +
    W_TRAINING * me.training +
    W_ATIUM * me.atium +
    W_PMONEY * me.pMoney +
    W_PDAMAGE * me.pDamage +
    W_DEFENDERS * defenderHP(me) +
    W_CUR_BOXINGS * me.curBoxings +
    W_CUR_MISSION_CARRY * me.curMission +
    W_CUR_MONEY_CARRY * me.curMoney -
    W_DECK_BLOAT * deckBloatPenalty(me);

  const oppScore =
    W_HP * opp.curHealth +
    W_MISSION * missionProgressScore(game, opp.turnOrder) +
    W_DECK_QUALITY * deckQuality(opp) +
    W_ALLIES_ONGOING * allyOngoingValue(opp) +
    W_TRAINING * opp.training +
    W_ATIUM * opp.atium +
    W_PMONEY * opp.pMoney +
    W_PDAMAGE * opp.pDamage +
    W_DEFENDERS * defenderHP(opp) -
    W_DECK_BLOAT * deckBloatPenalty(opp);

  return myScore - oppScore;
}
