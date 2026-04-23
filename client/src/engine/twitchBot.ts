import { Player, copyPlayerState } from "./player";
import { Action, Ally, Card, Funding } from "./card";
import { PlayerDeck } from "./deck";
import type { Game } from "./game";
import type { GameActionInternal } from "./types";
import { evaluateState } from "./twitchEval";

// ── Config ──

const MAX_NODES_EXPLORED = 10000;  // hard cap per turn; bail early if exceeded
const MAX_TURN_DEPTH = 10;         // max actions per turn in search
const MAX_CHILDREN = 5;            // beam width at each node (plus end_actions, always included)
const MAX_BUYS_PER_TURN = 2;       // E17
const DEBUG = process.env.TWITCH_DEBUG === "1";

// ── Heuristics shared by real-play and simulation-play ──

// Simple card-value function (mirrors twitchEval's but local so we don't tangle
// the modules). Used by prompt-response heuristics like eliminateIn.
function cardValue(card: Card): number {
  if (card instanceof Funding) return 1.0;
  if (card instanceof Action) {
    const d = card.data;
    const ab1 = parseInt(d[4] || "0", 10) * 1.0;
    const ab2 = parseInt(d[6] || "0", 10) * 0.6;
    return ab1 + ab2;
  }
  if (card instanceof Ally) {
    const d = card.data;
    const ab1 = parseInt(d[4] || "0", 10) * 1.0;
    const ab2 = parseInt(d[6] || "0", 10) * 0.6;
    const def = card.defender ? card.health * 2.5 : 0;
    return ab1 + ab2 + def;
  }
  return 0;
}

function pickLowestValue(cards: Card[]): number {
  if (cards.length === 0) return -1;
  let best = 0;
  let bestVal = cardValue(cards[0]);
  for (let i = 1; i < cards.length; i++) {
    const v = cardValue(cards[i]);
    if (v < bestVal) { bestVal = v; best = i; }
  }
  return best;
}

function pickHighestValue(cards: Card[]): number {
  if (cards.length === 0) return -1;
  let best = 0;
  let bestVal = cardValue(cards[0]);
  for (let i = 1; i < cards.length; i++) {
    const v = cardValue(cards[i]);
    if (v > bestVal) { bestVal = v; best = i; }
  }
  return best;
}

/** Apply the shared prompt-response heuristics to a Player instance (Twitch
 *  or SimPlayer). Kept free-function so both classes call the same logic. */
function installPromptHeuristics(p: Player) {
  p.eliminateIn = function (this: Player): number {
    const h = this.deck.hand.length;
    const d = this.deck.discard.length;
    const c = this.deck.cards.length;
    if (d + h + c <= 5) return -1;
    // Priority: Funding (dead weight in most late decks).
    for (let i = 0; i < this.deck.hand.length; i++) {
      if (this.deck.hand[i] instanceof Funding) return i;
    }
    for (let i = 0; i < this.deck.discard.length; i++) {
      if (this.deck.discard[i] instanceof Funding) return i + h;
    }
    const all = [...this.deck.hand, ...this.deck.discard];
    if (all.length === 0) return -1;
    return pickLowestValue(all);
  };
  p.pullIn = function (this: Player): number {
    if (this.deck.discard.length === 0) return -1;
    const idx = pickHighestValue(this.deck.discard);
    if (cardValue(this.deck.discard[idx]) < 0.5) return -1;
    return idx;
  };
  p.subdueIn = function (_choices: Card[]): number {
    if (_choices.length === 0) return -1;
    return pickHighestValue(_choices);
  };
  p.soarIn = function (_choices: Card[]): number {
    if (_choices.length === 0) return -1;
    return pickHighestValue(_choices);
  };
  p.keeperIn = function (_choices: Card[]): number {
    if (_choices.length === 0) return -1;
    return pickHighestValue(_choices);
  };
  p.confrontationIn = function (_choices: Action[]): number {
    if (_choices.length === 0) return -1;
    return pickHighestValue(_choices);
  };
  p.killEnemyAllyIn = function (_allies: Ally[]): number {
    if (_allies.length === 0) return -1;
    return pickHighestValue(_allies);
  };
  p.assignDamageIn = function (_targets: Ally[]): number {
    // Kill the biggest target we can afford (always correct: removes the most
    // equivalent value). Caller already filtered to `curDamage >= health`.
    if (_targets.length === 0) return -1;
    let best = 0;
    let bestHP = _targets[0].health;
    for (let i = 1; i < _targets.length; i++) {
      if (_targets[i].health > bestHP) { bestHP = _targets[i].health; best = i; }
    }
    return best;
  };
  p.riotIn = function (this: Player, riotable: Ally[]): Ally {
    return riotable[pickHighestValue(riotable)];
  };
  p.refreshIn = function (this: Player): number {
    for (let i = 0; i < this.metalTokens.length; i++) {
      if (this.metalTokens[i] === 2 || this.metalTokens[i] === 4) return i;
    }
    return 0;
  };
  p.pushIn = function (this: Player): number {
    if (this.game.market.hand.length === 0) return -1;
    return pickLowestValue(this.game.market.hand);
  };
  p.seekIn = function (_twice, _seeker, choices: Action[]): [number, number] {
    // Exclude seek-ability1 cards to avoid infinite seek→seek chains.
    const safe = choices
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !(c.data[3] || "").split(".").includes("seek"));
    if (safe.length === 0) return [-1, -1];
    let first = safe[0].i;
    let firstVal = cardValue(safe[0].c);
    for (const { c, i } of safe) {
      const v = cardValue(c);
      if (v > firstVal) { firstVal = v; first = i; }
    }
    if (!_twice) return [first, -1];
    let second = -1;
    let secondVal = -Infinity;
    for (const { c, i } of safe) {
      if (i === first) continue;
      const v = cardValue(c);
      if (v > secondVal) { secondVal = v; second = i; }
    }
    return [first, second];
  };
  p.chooseIn = function (_options: string[]): number {
    // Pick the option with highest per-unit effect value.
    let best = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < _options.length / 2; i++) {
      const eff = _options[2 * i];
      const amt = parseInt(_options[2 * i + 1] || "0", 10);
      // Crude: use 1.0 per unit. Good enough.
      const v = Math.abs(amt) * (eff === "Mi" ? 2.0 : 1.0);
      if (v > bestVal) { bestVal = v; best = i; }
    }
    return best;
  };
  p.informantIn = function (this: Player, card: Card): boolean {
    return cardValue(card) < 1.5;
  };
  p.senseCheckIn = function (_card: Action): boolean { return false; };
  p.cloudAlly = function (_card: Card, _ally: Ally): boolean { return false; };
  p.cloudP = function (_card: Action): boolean { return false; };
}

// ── Simulation player (used inside cloned games) ──

class SimPlayer extends Player {
  override selectAction(): GameActionInternal {
    throw new Error("SimPlayer.selectAction should never be called; simulation drives performAction directly");
  }
}

// Install the same prompt heuristics on SimPlayer instances via the factory.

function simPlayerFactory(original: Player, deck: PlayerDeck, newGame: Game, cardMap: Map<number, Card>): Player {
  const p = new SimPlayer(deck, newGame, original.turnOrder, original.name, original.character);
  copyPlayerState(p, original, cardMap);
  installPromptHeuristics(p);
  return p;
}

// ── Pruning ──

function isZeroEffect(effect: string, player: Player): boolean {
  // Split on "." and evaluate each sub-effect. If ALL are zero in current
  // state, the action contributes nothing.
  if (!effect) return true;
  const parts = effect.split(".");
  for (const e of parts) {
    if (!isSubEffectZero(e, player)) return false;
  }
  return true;
}

function isSubEffectZero(eff: string, player: Player): boolean {
  switch (eff) {
    case "H": return player.curHealth >= 40;                    // A1
    case "C": return player.deck.cards.length + player.deck.discard.length === 0;  // A2
    case "E": {
      const total = player.deck.hand.length + player.deck.discard.length + player.deck.cards.length;
      return total <= 5;                                        // A4
    }
    case "pull": return player.deck.discard.length === 0;       // A5
    case "push": return player.game.market.hand.length === 0;   // A5
    case "riot": return !player.allies.some((a) => a.availableRiot);  // A5
    case "K": {
      const opp = player.game.players[(player.turnOrder + 1) % 2];
      return opp.allies.length === 0;                           // A6
    }
    default: return false;
  }
}

function actionIsZeroEffect(action: GameActionInternal, player: Player): boolean {
  switch (action.type) {
    case "burn_metal":
    case "flare_metal": {
      // Find the card being consumed by this metal slot
      const card = findCardAtMetalSlot(player, action.metalIndex);
      if (!card) return false;
      return isZeroEffect(card.data[3], player);                // B9 (metal uses ability1)
    }
    case "ally_ability_1": {
      return isZeroEffect((action.card as Ally).data[3], player);  // A7
    }
    case "ally_ability_2": {
      return isZeroEffect((action.card as Ally).data[5], player);  // A7
    }
    case "char_ability_1": {
      return isZeroEffect(player.ability1effect, player);       // A7
    }
    case "char_ability_3": {
      return isZeroEffect("D.Mi", player);                      // special — always D+Mi
    }
    case "use_atium": {
      return isZeroEffect(player.ability1effect, player);       // B10 (atium re-uses ability1)
    }
    default: return false;
  }
}

function findCardAtMetalSlot(player: Player, metalIndex: number): Action | null {
  // A use_metal action consumes the card whose metal matches and is in hand.
  // Multiple cards can share a metal; we pick any (all have same data[3]).
  for (const c of player.deck.hand) {
    if (c instanceof Action && c.metal === metalIndex) return c;
  }
  return null;
}

function isBuyAction(action: GameActionInternal): boolean {
  return action.type === "buy" || action.type === "buy_eliminate"
      || action.type === "buy_with_boxings" || action.type === "buy_elim_boxings"
      || action.type === "buy_boxing";
}

/** Quick heuristic score for action ordering — used to pick which children
 *  to expand when beam width is exceeded. Higher = more promising. */
function quickScoreAction(action: GameActionInternal, player: Player): number {
  switch (action.type) {
    case "end_actions": return -100;  // always-present floor; we add it explicitly
    case "char_ability_1": return 10 + estimateEffect(player.ability1effect, player.ability1amount);
    case "char_ability_3": return 20;  // D.Mi 3.3 — strong
    case "use_metal": {
      const c = action.card as Action;
      return 8 + estimateEffect(c.data[3], c.data[4]);
    }
    case "burn_card": {
      const c = action.card;
      if (c instanceof Action) {
        const burn = estimateEffect(c.data[11] || "", c.data[12] || "");
        const ab1 = estimateEffect(c.data[3], c.data[4]);
        return 3 + burn + ab1 * 0.5; // burn produces effect + enables ability1 via metal
      }
      return 1;
    }
    case "burn_metal": {
      // Worth it if we have a card in hand to consume the slot
      const match = findCardAtMetalSlot(player, action.metalIndex);
      if (!match) return -5;
      return 4 + estimateEffect(match.data[3], match.data[4]);
    }
    case "flare_metal": {
      const match = findCardAtMetalSlot(player, action.metalIndex);
      if (!match) return -3;
      return 3 + estimateEffect(match.data[3], match.data[4]);
    }
    case "refresh_metal": {
      const c = action.card as Action;
      return 2 + estimateEffect(c.data[3], c.data[4]);
    }
    case "ally_ability_1": {
      return 7 + estimateEffect((action.card as Ally).data[3], (action.card as Ally).data[4]);
    }
    case "ally_ability_2": {
      return 5 + estimateEffect((action.card as Ally).data[5], (action.card as Ally).data[6]);
    }
    case "advance_mission": {
      const rank = action.mission.playerRanks[player.turnOrder];
      // Prioritize missions closer to 12 (big payoff at completion)
      return 6 + rank * 0.5;
    }
    case "buy": {
      return 2 + cardValue(action.card);
    }
    case "buy_eliminate": {
      return 3 + cardValue(action.card);
    }
    case "buy_with_boxings": return 1 + cardValue(action.card);
    case "buy_elim_boxings": return 2 + cardValue(action.card);
    case "buy_boxing": {
      // Only useful if curMoney is odd near end (otherwise end_actions converts efficiently)
      return player.curMoney % 2 === 1 ? 0 : -3;
    }
    case "use_boxing": {
      // Useful only if we NEED 1 more money for a buy
      return player.curBoxings > 2 ? 0 : -3;
    }
    case "use_atium": return 15;
    default: return 0;
  }
}

function estimateEffect(effect: string, amount: string): number {
  if (!effect) return 0;
  const effs = effect.split(".");
  const amts = amount.split(".");
  let total = 0;
  const VALS: Record<string, number> = {
    D: 1.0, M: 1.0, H: 0.5, Mi: 2.0, C: 2.5, T: 3.0, E: 2.0,
    A: 2.5, B: 3.0, K: 3.0, R: 1.5, pull: 1.5, push: 1.0, riot: 2.0,
    seek: 2.0, Pc: 10, Pd: 8, Pm: 7,
  };
  for (let i = 0; i < effs.length; i++) {
    const e = effs[i];
    if (e === "choose") continue;
    const n = parseInt(amts[i] || "0", 10);
    total += Math.abs(n) * (VALS[e] ?? 1.0);
  }
  return total;
}

function applyPruningRules(
  actions: GameActionInternal[],
  player: Player,
  buysUsed: number,
): GameActionInternal[] {
  return actions.filter((action) => {
    // E17: max 2 buys per turn
    if (buysUsed >= MAX_BUYS_PER_TURN && isBuyAction(action)) return false;
    // A rules: zero-effect skip
    if (actionIsZeroEffect(action, player)) return false;
    // B8: burn_card pruning — skip if no productive metal consumer available.
    // Simple heuristic: if the target metalIndex's effect is zero-effect, skip.
    if (action.type === "burn_card") {
      if (isZeroEffect(action.card.data[3], player)) return false;
    }
    return true;
  });
}

// ── Search ──

interface SearchState {
  game: Game;
  path: GameActionInternal[];
  buysUsed: number;
}

interface SearchContext {
  nodesExplored: number;
  bestScore: number;
  bestPath: GameActionInternal[];
  myTurnOrder: number;
}

function finalizeTurnAndScore(game: Game, myTurnOrder: number): number {
  const me = game.players[myTurnOrder];
  if (!game.winner) {
    me.assignDamage(game);
    game.attack(me);
    me.curDamage = 0;
  }
  return evaluateState(game, me);
}

function search(state: SearchState, ctx: SearchContext, depth: number): void {
  ctx.nodesExplored += 1;
  if (ctx.nodesExplored > MAX_NODES_EXPLORED) return;

  const me = state.game.players[ctx.myTurnOrder];

  // Terminal: game ended, or path ended in end_actions.
  const lastAction = state.path.length > 0 ? state.path[state.path.length - 1] : null;
  if (state.game.winner || lastAction?.type === "end_actions") {
    // Damage phase already ran via performAction for end_actions (no — it didn't;
    // end_actions only does cleanup, not assignDamage/attack). Finalize now.
    const score = finalizeTurnAndScore(state.game, ctx.myTurnOrder);
    if (score > ctx.bestScore) {
      ctx.bestScore = score;
      ctx.bestPath = state.path;
    }
    return;
  }

  // Force end if depth exceeded
  if (depth >= MAX_TURN_DEPTH) {
    const actions = me.availableActions(state.game);
    const end = actions.find((a) => a.type === "end_actions");
    if (end) {
      const clone = state.game.clone(simPlayerFactory);
      clone.players[ctx.myTurnOrder].performAction(end, clone);
      const score = finalizeTurnAndScore(clone, ctx.myTurnOrder);
      if (score > ctx.bestScore) {
        ctx.bestScore = score;
        ctx.bestPath = [...state.path, end];
      }
    }
    return;
  }

  const legalActions = me.availableActions(state.game);
  const pruned = applyPruningRules(legalActions, me, state.buysUsed);

  // Score non-end actions for beam ordering; keep top-K.
  const endAction = pruned.find((a) => a.type === "end_actions");
  const others = pruned
    .filter((a) => a.type !== "end_actions")
    .map((a) => ({ a, score: quickScoreAction(a, me) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, MAX_CHILDREN)
    .map((x) => x.a);
  // end_actions is always first so we have a baseline leaf score.
  const ordered = endAction ? [endAction, ...others] : others;

  for (const action of ordered) {
    if (ctx.nodesExplored > MAX_NODES_EXPLORED) return;
    const clone = state.game.clone(simPlayerFactory);
    const cloneMe = clone.players[ctx.myTurnOrder];
    // Find the corresponding action on the clone (same shape, cards resolved via cardMap).
    // Since cards preserve id, and availableActions on the clone would regenerate with
    // cloned card refs, we regenerate here:
    const cloneActions = cloneMe.availableActions(clone);
    const cloneAction = matchAction(cloneActions, action);
    if (!cloneAction) continue;
    cloneMe.performAction(cloneAction, clone);
    const newBuys = state.buysUsed + (isBuyAction(action) ? 1 : 0);
    search(
      { game: clone, path: [...state.path, action], buysUsed: newBuys },
      ctx,
      depth + 1,
    );
  }
}

/** Match a source action to its clone-world equivalent by type+card-id+metalIndex+etc.
 *  Returns the clone-world action instance (with correct references). */
function matchAction(cloneActions: GameActionInternal[], src: GameActionInternal): GameActionInternal | null {
  for (const a of cloneActions) {
    if (a.type !== src.type) continue;
    // Compare relevant fields by id / reference-independent keys
    if (actionsMatchByKeys(a, src)) return a;
  }
  return null;
}

function actionsMatchByKeys(a: GameActionInternal, b: GameActionInternal): boolean {
  if (a.type !== b.type) return false;
  if ("card" in a && "card" in b) {
    if (a.card.id !== b.card.id) return false;
  }
  if ("metalIndex" in a && "metalIndex" in b) {
    if (a.metalIndex !== b.metalIndex) return false;
  }
  if ("mission" in a && "mission" in b) {
    if (a.mission.name !== b.mission.name) return false;
  }
  if ("boxingsCost" in a && "boxingsCost" in b) {
    if (a.boxingsCost !== b.boxingsCost) return false;
  }
  return true;
}

// ── Twitch bot ──

export class Twitch extends Player {
  private plannedActions: GameActionInternal[] = [];
  private planCursor = 0;

  constructor(deck: PlayerDeck, game: Game, turnOrder: number, name = "Twitch", character = "Kelsier") {
    super(deck, game, turnOrder, name, character);
    installPromptHeuristics(this);
  }

  override selectAction(actions: GameActionInternal[], game: Game): GameActionInternal {
    if (this.planCursor >= this.plannedActions.length) {
      this.plannedActions = this.computePlan(game);
      this.planCursor = 0;
    }
    while (this.planCursor < this.plannedActions.length) {
      const planned = this.plannedActions[this.planCursor++];
      const match = matchAction(actions, planned);
      if (match) return match;
      // Planned action no longer legal — skip and try the next.
    }
    // Fallback: end_actions
    return actions.find((a) => a.type === "end_actions") ?? actions[0];
  }

  private computePlan(game: Game): GameActionInternal[] {
    const ctx: SearchContext = {
      nodesExplored: 0,
      bestScore: -Infinity,
      bestPath: [],
      myTurnOrder: this.turnOrder,
    };
    const rootClone = game.clone(simPlayerFactory);
    if (DEBUG) {
      const me = rootClone.players[this.turnOrder];
      const rootActions = me.availableActions(rootClone);
      const rootPruned = applyPruningRules(rootActions, me, 0);
      console.log(`[Twitch T${game.turncount}] rootActions=${rootActions.length} pruned=${rootPruned.length} types=${[...new Set(rootPruned.map((a) => a.type))].join(",")}`);
    }
    search({ game: rootClone, path: [], buysUsed: 0 }, ctx, 0);
    if (DEBUG) {
      const types = ctx.bestPath.map((a) => a.type).join(",");
      console.log(`[Twitch T${game.turncount}] nodes=${ctx.nodesExplored} score=${ctx.bestScore.toFixed(1)} plan=${types}`);
    }
    return ctx.bestPath;
  }
}

export function createTwitch(
  deck: PlayerDeck,
  game: Game,
  turnOrder: number,
  name = "Twitch",
  character = "Kelsier",
): Player {
  return new Twitch(deck, game, turnOrder, name, character);
}
