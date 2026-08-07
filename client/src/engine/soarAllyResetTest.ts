/**
 * Regression test for Soar returning a previously used ally from market trash.
 *
 * Run: npx tsx client/src/engine/soarAllyResetTest.ts
 */
import { Ally } from "./card";
import { Game } from "./game";
import type { CardDef } from "./types";

const allyDef: CardDef = {
  cardType: 3, name: "Recycled Ally", cost: 3, metal: 0,
  ability1Effect: "M", ability1Amount: "1", health: 2,
};

const game = new Game({ testDeck: true, seed: 1 });
const player = game.players[0];
const ally = new Ally(allyDef);

// Simulate an ally that was Buy + Eliminated after using its ability.
ally.available1 = false;
game.market.discard = [ally];
player.curMoney = ally.cost;
player.soarIn = () => 0;

player.special9();

if (!player.deck.discard.includes(ally)) {
  throw new Error("Soar did not move the chosen ally to the player's discard");
}
if (!ally.available1) {
  throw new Error("Soar returned an ally with its ability still unavailable");
}

console.log("Soar ally reset regression test passed.");
