// ── Lands: a 2-player basic-land card game ──
//
// Each deck = 5 copies of each of 5 basic land types (25 cards).
// Each turn: draw, then optionally play one land. Each land has an effect.
// Win: 1 of each type in play simultaneously, OR 5 of any single type in play.
// When an opponent plays a land, you may counter by discarding an Island AND
// a matching copy of the land being played.

export const LAND_TYPES = ["plains", "island", "swamp", "mountain", "forest"] as const;
export type LandType = (typeof LAND_TYPES)[number];

export interface LandCard {
  /** Unique within a game session — needed because there are 5 copies per type. */
  id: number;
  type: LandType;
  /** Which player owns this card (0 or 1). Stays with the card across zones. */
  owner: 0 | 1;
  /**
   * Whether the non-owner has seen this card's face. Set when a Swamp peeks
   * at the owner's hand. Monotonic: once revealed, stays revealed even if the
   * card moves between zones (cards become public information once seen, and
   * tracking de-reveal would require modeling opponent memory).
   */
  revealedToOpponent?: boolean;
}

export interface PlayerState {
  name: string;
  /** Top of deck is index 0 (drawn first). */
  deck: LandCard[];
  hand: LandCard[];
  inPlay: LandCard[];
  discard: LandCard[];
}

export type GamePhase =
  /** Active player's main step — may play one card or pass. */
  | "main"
  /** Opponent of the active player decides whether to counter the pending play. */
  | "counter_window"
  /** Active player picks one of opponent's in-play lands to destroy. */
  | "mountain_target"
  /** Active player views opponent's hand and picks one card to discard. */
  | "swamp_view"
  /** Active player picks one card from their own discard to return to hand. */
  | "forest_pick"
  /** Active player scrys top 4: pick any to discard, reorder the rest on top. */
  | "island_scry"
  | "game_over";

export interface LogEntry {
  turn: number;
  player: 0 | 1 | null;
  text: string;
  /** Variant text shown only to the actor (the player who took the action).
   *  Used for "private knowledge" lines like an Island scry that reveals
   *  kept cards to the player but only the count to their opponent. */
  ownerText?: string;
}

export interface PendingPlay {
  /** The card being played (currently between hand and play area). */
  card: LandCard;
  /** Who played it. */
  player: 0 | 1;
  /** Pre-chosen target for cards that target on play (Mountain, Forest).
   *  Locked in BEFORE the counter window opens so the counter player knows
   *  what's at stake. Undefined for non-targeting cards or fizzle cases. */
  target?: LandCard;
}

export interface IslandScryState {
  /** The (up to 4) cards revealed off the top of the active player's deck. */
  revealed: LandCard[];
}

export interface GameState {
  players: [PlayerState, PlayerState];
  activePlayer: 0 | 1;
  turnCount: number;
  phase: GamePhase;
  pending: PendingPlay | null;
  islandScry: IslandScryState | null;
  winner: 0 | 1 | null;
  /** Why the game ended, for the game-over screen. */
  winReason: string | null;
  /**
   * The viewer's own bluff-mode setting. Each player has their own — the
   * opponent's value is never shipped in the perspective-filtered snapshot,
   * so neither side can free-read whether the other has bluff enabled.
   * Toggleable via setBluffMode().
   */
  bluffMode: boolean;
  log: LogEntry[];
}
