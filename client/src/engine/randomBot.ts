import { Twonky } from "./bot";
import type { PlayerDeck } from "./deck";
import type { Game } from "./game";
import type { Player } from "./player";
import type { Card } from "./card";

// Twonky with randomized card ratings, mission ratings, and buy buffer.
// Ratings are cached per card/mission name so scores stay stable within a
// game (otherwise Twonky's selectAction would thrash re-sorting the same hand).
export class RandomBot extends Twonky {
  private randomCardCache: Record<string, number> = {};
  private randomMissionCache: Record<string, number> = {};

  constructor(deck: PlayerDeck, game: Game, turnOrder: number, name = "Random", character = "Marsh") {
    super(deck, game, turnOrder, name, character);
    this.buffer = Math.random() * 0.5 - 0.25;
    this.missionLookup = new Proxy(this.randomMissionCache, {
      get: (target, prop: string) => {
        if (!(prop in target)) target[prop] = Math.random();
        return target[prop];
      },
    });
  }

  protected override cardLookup(card: Card): number {
    if (!(card.name in this.randomCardCache)) {
      this.randomCardCache[card.name] = Math.random();
    }
    return this.randomCardCache[card.name];
  }

  protected override sortingAlgo(card: Card): number {
    return this.cardLookup(card);
  }
}

export function createRandomBot(
  deck: PlayerDeck,
  game: Game,
  turnOrder: number,
  name: string,
  character: string,
): Player {
  return new RandomBot(deck, game, turnOrder, name, character);
}
