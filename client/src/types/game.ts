export interface CardData {
  id: number;
  name: string;
  type: "action" | "ally" | "funding" | "card";
  cost: number;
  metal: number;
  metalName: string;
  sought: boolean;
  // Action-specific
  capacity?: number;
  metalUsed?: number;
  burned?: boolean;
  abilities?: { effect: string; amount: string }[];
  /** Raw slots preserving empty positions (null). Length 3; a card with
   *  ability at slot 1 and slot 3 looks like [obj, null, obj]. */
  abilitySlots?: ({ effect: string; amount: string } | null)[];
  activeAbility?: { effect: string; amount: string };
  burnAbility?: { effect: string; amount: string };
  // Ally-specific
  health?: number;
  defender?: boolean;
  available1?: boolean;
  available2?: boolean;
}

export interface MissionTier {
  threshold: number;
  reward: string;
  rewardAmount: number;
  firstReward: string;
  firstRewardAmount: number;
}

export interface MissionData {
  name: string;
  playerRanks: number[];
  /** Player index of whoever reached the top of this mission first.
   *  null until either player crosses the top tier. */
  topReachedBy: number | null;
  tiers: MissionTier[];
  maxRank: number;
}

export interface PlayerData {
  name: string;
  character: string;
  turnOrder: number;
  alive: boolean;
  health: number;
  damage: number;
  money: number;
  mission: number;
  boxings: number;
  hand: CardData[];
  handSize: number;
  deckSize: number;
  discardSize: number;
  discard: CardData[];
  deck?: CardData[];
  allies: CardData[];
  metalTokens: number[];
  metalAvailable: number[];
  metalBurned: number[];
  metalNames: string[];
  burns: number;
  atium: number;
  training: number;
  maxHandSize: number;
  pDamage: number;
  pMoney: number;
  charAbility1: boolean;
  charAbility2: boolean;
  charAbility3: boolean;
  ability1metal: string;
  ability1effect: string;
  ability1amount: string;
}

export interface MarketData {
  hand: CardData[];
  deckSize: number;
  discardSize: number;
  discard: CardData[];
}

export interface GameAction {
  code: number;
  type: string; // ActionType string enum (new)
  index: number;
  description: string;
  cardId?: number;
  metalIndex?: number;
  missionName?: string;
  boxingsCost?: number;
}

/** Declarative spec for the second action in a "X then Y" composite
 *  (serializable so it can be sent from a multiplayer guest to the host). */
export interface SecondMatch {
  code: number;
  cardIds?: number[];
}

export interface BotLogEntry {
  turn: number;
  text: string;
  card?: CardData;
  /** Multiple cards behind a single combined event — currently used by
   *  cloud_block when multiple cloud cards resolve a single damage event. */
  cards?: CardData[];
  actionType?: string;
  metalIndex?: number;
  /** For reactive defender entries (sense_block / opponent_kill / etc.)
   *  in the player's log, this records how many entries had been pushed to
   *  the BOT's log when this entry was created — letting the renderer
   *  interleave the defender's reaction at the exact spot in the bot's
   *  action sequence where it fired (e.g. "Used Spy" lands right after the
   *  bot's Advance entry, not at the end of the turn). */
  afterBotIdx?: number;
}

export interface PromptOption {
  index: number;
  cardId?: number;
  name?: string;
  cost?: number;
  source?: string;
  effect?: string;
  amount?: string;
  metal?: string;
  [key: string]: unknown;
}

export interface GamePrompt {
  type: string;
  options: PromptOption[];
  context: string;
}

export interface DamageTarget {
  index: number;
  name: string;
  health: number;
  cardId: number;
}

export interface SenseCard {
  cardId: number;
  name: string;
  amount: number;
}

export interface CloudCard {
  cardId: number;
  name: string;
  reduction: number;
}

export interface GameState {
  sessionId: string;
  phase: "actions" | "damage" | "sense_defense" | "cloud_defense" | "ally_defense" | "awaiting_prompt" | "game_over";
  turnCount: number;
  winner: string | null;
  victoryType: string | null;
  metalCodes: string[];
  market: MarketData;
  missions: MissionData[];
  players: PlayerData[];
  availableActions: GameAction[];
  damageTargets?: DamageTarget[];
  faceHitBlocked?: boolean;
  senseCards?: SenseCard[];
  senseMissionName?: string;
  cloudCards?: CloudCard[];
  incomingDamage?: number;
  /** Cloud-ally cards (e.g. Hide) available to spend when an opponent is
   *  trying to kill one of our allies. Populated during `ally_defense`. */
  cloudAllyCards?: { cardId: number; name: string }[];
  /** Ally currently targeted for kill. Populated during `ally_defense`. */
  targetedAlly?: { name: string; cardId: number; health: number };
  botLog?: BotLogEntry[];
  playerLog?: BotLogEntry[];
  prompt?: GamePrompt;
  canUndo?: boolean;
  // Multiplayer fields
  activePlayer?: number;
  myPlayerIndex?: number;
  isMyTurn?: boolean;
  isWinner?: boolean;
}
