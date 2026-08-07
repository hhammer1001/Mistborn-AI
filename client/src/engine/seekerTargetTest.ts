/**
 * Regression test for Seeker Ability 2 selecting the wrong sought card.
 *
 * Run: npx tsx client/src/engine/seekerTargetTest.ts
 */
import { Action, Ally } from "./card";
import { Game } from "./game";
import { snapshotGame, restoreGame } from "./gameSnapshot";
import type { CardDef } from "./types";

const seekerDef: CardDef = {
  cardType: 3, name: "Seeker", cost: 5, metal: 2,
  ability1Effect: "seek", ability1Amount: "-5",
  ability2Effect: "special16", ability2Amount: "0", health: 3,
};
const eliminateDef: CardDef = {
  cardType: 2, name: "Other Sought Card", cost: 2, metal: 0,
  ability1Effect: "E", ability1Amount: "1",
};
const moneyDef: CardDef = {
  cardType: 2, name: "Selected Card", cost: 2, metal: 0,
  ability1Effect: "M", ability1Amount: "1",
};

const game = new Game({ testDeck: true, seed: 1 });
const player = game.players[0];
const otherSought = new Action(eliminateDef);
const selected = new Action(moneyDef);
const seeker = new Ally(seekerDef);
game.market.hand = [otherSought, selected];
player.allies = [seeker];

// Choose the second card for Seeker 1, while leaving an earlier market card
// marked sought to reproduce the old market-order bug.
player.seekIn = () => [1, -1];
seeker.ability1(player);
otherSought.sought = true;
player.curMoney = 0;

seeker.ability2(player);
if (player.curMoney !== 1) {
  throw new Error(`Seeker Ability 2 replayed the wrong card (money: ${player.curMoney})`);
}

// Prompt rollback/lookahead snapshots must retain the per-Seeker selection.
const snap = snapshotGame(game);
seeker.soughtCardId = null;
restoreGame(game, snap);
if (seeker.soughtCardId !== selected.id) {
  throw new Error("Seeker target was not preserved in game snapshots");
}

console.log("Seeker target regression test passed.");
