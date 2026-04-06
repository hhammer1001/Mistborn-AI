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
}

export interface GameAction {
  code: number;
  index: number;
  description: string;
  cardId?: number;
  metalIndex?: number;
  missionName?: string;
  boxingsCost?: number;
}

export interface GameState {
  sessionId: string;
  phase: "actions" | "game_over";
  turnCount: number;
  winner: string | null;
  victoryType: string | null;
  metalCodes: string[];
  market: MarketData;
  missions: MissionData[];
  players: PlayerData[];
  availableActions: GameAction[];
}
