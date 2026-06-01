/**
 * Hulk X90 — composite "best of both worlds" bot.
 *
 * Going first  (turnOrder=0): SquashV2Bot — seat-0 specialist (~70.5% vs Zoom 2nd)
 * Going second (turnOrder=1): ZoomBot      — seat-2 specialist (~39% vs Squash 1st)
 *
 * Coin-flipped expected win rate vs other bots (n=2000 seeded):
 *   vs Squash:  ~78% (V2 1st 76.4%, Zoom 2nd ~80%)
 *   vs Twonky:  ~81% (V2 1st 89.3%, Zoom 2nd 74.3%)
 *   vs Zoom:    Hulk picks the specialist seat too, so half/half resolves to
 *               SquashV2-1st-vs-Zoom-2nd 70.4% on half the games and
 *               Zoom-2nd-vs-SquashV2-1st mirror'd to 65.4% Hulk win on the
 *               other half — but since BOTH bots try to be in their preferred
 *               seat, the comparison only matters when seats are fixed.
 *
 * Hulk isn't a class — it's a factory dispatcher. The returned Player IS a
 * real SquashV2Bot or ZoomBot, so session.ts, lookahead, lethal solver, and
 * all eval-profile machinery work without changes.
 */

import type { Game } from "./game";
import type { Player } from "./player";
import type { PlayerDeck } from "./deck";
import { SquashV3Bot } from "./squashV3Bot";
import { ZoomBot } from "./zoomBot";

export function createHulkX90(
  deck: PlayerDeck,
  game: Game,
  turnOrder: number,
  name: string,
  character: string,
): Player {
  // Going first: SquashV3 (SquashV2 + validated going-first tweaks — skip the
  // opp-lead mission penalty on the bot's own path, flare/burn-metal cost cuts).
  // ~+1.5pp vs strong mission-racers (validated head-to-head), uses the same
  // committed self-play weights as V2 (a full-scale retrain did not help).
  // Going second: ZoomBot (seat-1 specialist), unchanged.
  return turnOrder === 0
    ? new SquashV3Bot(deck, game, turnOrder, name, character)
    : new ZoomBot(deck, game, turnOrder, name, character);
}
