/**
 * WebPlayer: A Player subclass for web-based play.
 *
 * The session manager drives the turn loop instead of playTurn(), so selectAction
 * is never called. The *In methods either use saved prompt responses or throw
 * PromptNeeded to request user input from the frontend.
 */

import { Player } from "./player";
import { Card, Action, Ally } from "./card";
import { PromptNeeded } from "./prompt";
import type { PromptOption } from "./prompt";
import type { PlayerDeck } from "./deck";
import type { Game } from "./game";
import type { GameActionInternal } from "./types";

export class WebPlayer extends Player {
  _promptResponses: Record<string, number | boolean> = {};
  _promptQueues: Record<string, (number | boolean)[]> = {};
  _sense_flag = false;

  constructor(deck: PlayerDeck, game: Game, turnOrder: number, name = "Player", character = "Kelsier") {
    super(deck, game, turnOrder, name, character);
  }

  setPromptResponse(promptType: string, value: number | boolean) {
    if (this._promptQueues[promptType]) {
      this._promptQueues[promptType].push(value);
    } else {
      this._promptQueues[promptType] = [value];
    }
    this._promptResponses[promptType] = value;
  }

  clearPromptResponses() {
    this._promptResponses = {};
    this._promptQueues = {};
  }

  private _getResponse(promptType: string): number | boolean | undefined {
    const val = this._promptResponses[promptType];
    if (val !== undefined) {
      delete this._promptResponses[promptType];
      return val;
    }
    return undefined;
  }

  private _getQueueResponse(promptType: string): number | boolean | undefined {
    const q = this._promptQueues[promptType];
    if (q && q.length > 0) return q.shift();
    return undefined;
  }

  override selectAction(_actions: GameActionInternal[], _game: Game): GameActionInternal {
    throw new Error("WebPlayer.selectAction should not be called directly");
  }

  override assignDamageIn(targets: Ally[]): number {
    if (targets.length === 0) return -1;
    return targets.reduce((best, ally, i) =>
      ally.health > targets[best].health ? i : best, 0);
  }

  override senseCheckIn(_card: Action): boolean {
    return this._sense_flag;
  }

  override killEnemyAllyIn(allies: Ally[]): number {
    if (allies.length === 0) return -1;
    return allies.reduce((best, ally, i) =>
      ally.health > allies[best].health ? i : best, 0);
  }

  override cloudAlly(_card: Card, _ally: Ally): boolean {
    return false;
  }

  override eliminateIn(): number {
    const resp = this._getQueueResponse("eliminate");
    if (resp !== undefined) return Number(resp);

    const h = this.deck.hand.length;
    const d = this.deck.discard.length;
    if (h + d === 0) return -1;

    const options: PromptOption[] = [];
    for (let i = 0; i < this.deck.hand.length; i++) {
      const c = this.deck.hand[i];
      if (this._active_card && c.id === this._active_card.id) continue;
      options.push({ index: i, name: c.name, source: "hand" });
    }
    for (let i = 0; i < this.deck.discard.length; i++) {
      options.push({ index: i + h, name: this.deck.discard[i].name, source: "discard" });
    }
    if (options.length === 0) return -1;
    options.push({ index: -1, name: "Skip", source: "skip" });
    throw new PromptNeeded("eliminate", options, "Choose a card to eliminate");
  }

  override pullIn(): number {
    const resp = this._getQueueResponse("pull");
    if (resp !== undefined) return Number(resp);

    if (this.deck.discard.length === 0) return -1;
    const options: PromptOption[] = this.deck.discard.map((c, i) => ({
      index: i, name: c.name, source: "discard",
    }));
    options.push({ index: -1, name: "Skip", source: "skip" });
    throw new PromptNeeded("pull", options, "Choose a card to pull to top of deck");
  }

  override subdueIn(choices: Card[]): number {
    if (choices.length === 0) return -1;
    const resp = this._getResponse("subdue");
    if (resp !== undefined) return Number(resp);

    const options: PromptOption[] = choices.map((c, i) => ({
      index: i, name: c.name, cost: c.cost,
    }));
    options.push({ index: -1, name: "Skip", source: "skip" });
    throw new PromptNeeded("subdue", options, "Choose a market card to gain (cost ≤ 5)");
  }

  override soarIn(choices: Card[]): number {
    if (choices.length === 0) return -1;
    const resp = this._getResponse("soar");
    if (resp !== undefined) return Number(resp);

    const options: PromptOption[] = choices.map((c, i) => ({
      index: i, name: c.name,
    }));
    options.push({ index: -1, name: "Skip", source: "skip" });
    throw new PromptNeeded("soar", options, "Choose an eliminated card to gain");
  }

  override confrontationIn(choices: Action[]): number {
    if (choices.length === 0) return -1;
    const resp = this._getResponse("confrontation");
    if (resp !== undefined) return Number(resp);

    const options: PromptOption[] = choices.map((c, i) => ({
      index: i, name: c.name,
    }));
    options.push({ index: -1, name: "Skip", source: "skip" });
    throw new PromptNeeded("confrontation", options, "Choose an action card to play its top ability");
  }

  override informantIn(card: Card): boolean {
    const resp = this._getResponse("informant");
    if (resp !== undefined) return Boolean(resp);
    throw new PromptNeeded("informant",
      [{ index: 1, name: `Eliminate ${card.name}` }, { index: 0, name: "Put it back" }],
      `Top of deck: ${card.name}`);
  }

  override keeperIn(choices: Card[]): number {
    const resp = this._getResponse("keeper");
    if (resp !== undefined) return Number(resp);

    const options: PromptOption[] = choices.map((c, i) => ({
      index: i, name: c.name,
    }));
    throw new PromptNeeded("keeper", options, "Choose a card to set aside (draw next turn)");
  }

  override chooseIn(options: string[]): number {
    const resp = this._getResponse("choose");
    if (resp !== undefined) return Number(resp);

    const readable: PromptOption[] = [];
    for (let i = 0; i < options.length; i += 2) {
      readable.push({ index: i / 2, effect: options[i], amount: options[i + 1] });
    }
    throw new PromptNeeded("choose", readable, "Choose an effect");
  }

  override refreshIn(): number {
    const resp = this._getResponse("refresh");
    if (resp !== undefined) return Number(resp);

    const flared = this.metalTokens
      .map((val, i) => ({ i, val }))
      .filter(({ val }) => val === 2 || val === 4);
    if (flared.length <= 1) return flared[0]?.i ?? 0;

    throw new PromptNeeded("refresh",
      flared.map(({ i }) => ({ index: i, metal: this.game.metalCodes[i] })),
      "Choose a metal to refresh");
  }

  override pushIn(): number {
    const resp = this._getResponse("push");
    if (resp !== undefined) return Number(resp);

    const market = this.game.market.hand;
    if (market.length === 0) return -1;

    const options: PromptOption[] = market.map((c, i) => ({
      index: i, name: c.name, cost: c.cost,
    }));
    options.push({ index: -1, name: "Skip", source: "skip" });
    throw new PromptNeeded("push", options, "Choose a market card to eliminate");
  }

  override riotIn(riotable: Ally[]): Ally {
    if (riotable.length <= 1) return riotable[0];
    const resp = this._getResponse("riot");
    if (resp !== undefined) return riotable[Number(resp)];

    const options: PromptOption[] = riotable.map((a, i) => ({
      index: i, name: a.name,
    }));
    throw new PromptNeeded("riot", options, "Choose an ally to activate");
  }

  override seekIn(twice: boolean, seeker: boolean, choices: Action[]): [number, number] {
    if (choices.length === 0) return [-1, -1];

    // First selection
    const resp1 = this._getQueueResponse("seek");
    if (resp1 === undefined) {
      const options: PromptOption[] = choices.map((c, i) => ({
        index: i, name: c.name, cost: c.cost,
      }));
      options.push({ index: -1, name: "Skip", source: "skip" });
      const ctx = twice
        ? "Pierce: Choose 1st action to use its top ability (pick 2)"
        : seeker
        ? "Seek: Choose an action to use and mark as sought"
        : "Seek: Choose an action to use its top ability";
      throw new PromptNeeded("seek", options, ctx);
    }
    const choice1 = Number(resp1);

    if (!twice || choice1 === -1) return [choice1, -1];

    // Second selection
    const resp2 = this._getQueueResponse("seek");
    if (resp2 === undefined) {
      const options: PromptOption[] = choices
        .map((c, i) => ({ index: i, name: c.name, cost: c.cost }))
        .filter((o) => o.index !== choice1);
      options.push({ index: -1, name: "Skip", source: "skip" });
      throw new PromptNeeded("seek", options, "Choose a 2nd action to use (different from 1st)");
    }

    return [choice1, Number(resp2)];
  }

  override cloudP(_card: Action): boolean {
    return false; // Handled by cloud_defense phase after bot turn
  }
}

/** Factory function matching PlayerFactory signature */
export function createWebPlayer(
  deck: PlayerDeck,
  game: Game,
  turnOrder: number,
  name: string,
  character: string,
): Player {
  return new WebPlayer(deck, game, turnOrder, name, character);
}
