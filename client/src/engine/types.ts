// ── Card data definition (replaces CSV row arrays) ──

export interface CardDef {
  cardType: 1 | 2 | 3; // 1=Funding, 2=Action, 3=Ally
  name: string;
  cost: number;
  metal: number; // 0-8 index, -1 for neutral
  // Action fields (cardType 2):
  ability1Effect?: string;
  ability1Amount?: string;
  ability2Effect?: string;
  ability2Amount?: string;
  ability3Effect?: string;
  ability3Amount?: string;
  activeEffect?: string;
  activeAmount?: string;
  burnEffect?: string;
  burnAmount?: string;
  // Ally fields (cardType 3):
  health?: number;
  defenseType?: string; // "D" for defender, "Pc" for perm draw, "B" for extra burn
}

export interface StarterCardDef extends CardDef {
  deckGroup: 0 | 1; // 0 = Kelsier/Shan deck, 1 = Vin/Marsh/Prodigy deck
}

export interface CharacterDef {
  name: string;
  ability1Metal: number; // metal index for character ability 1
  ability1Effect: string;
  ability1Amount: string;
}

// ── Action type system ──

export type ActionType =
  | "end_actions"
  | "advance_mission"
  | "burn_card"
  | "refresh_metal"
  | "use_metal"
  | "burn_metal"
  | "flare_metal"
  | "buy"
  | "buy_eliminate"
  | "ally_ability_1"
  | "ally_ability_2"
  | "char_ability_1"
  | "char_ability_3"
  | "use_atium"
  | "buy_with_boxings"
  | "buy_elim_boxings"
  | "buy_boxing"
  | "use_boxing";

// Engine-internal action objects (discriminated union).
// These hold live object references and are used inside the engine only.
// The `index` field is assigned by serialize_actions after generation.

import type { Action as ActionCard } from "./card";
import type { Card } from "./card";
import type { Mission } from "./mission";

export type GameActionInternal =
  | { type: "end_actions"; index: number }
  | { type: "advance_mission"; index: number; mission: Mission }
  | { type: "burn_card"; index: number; card: ActionCard; metalIndex: number }
  | { type: "refresh_metal"; index: number; card: ActionCard; metalIndex: number }
  | { type: "use_metal"; index: number; card: ActionCard }
  | { type: "burn_metal"; index: number; metalIndex: number }
  | { type: "flare_metal"; index: number; metalIndex: number }
  | { type: "buy"; index: number; card: Card }
  | { type: "buy_eliminate"; index: number; card: Card }
  | { type: "ally_ability_1"; index: number; card: Card }
  | { type: "ally_ability_2"; index: number; card: Card }
  | { type: "char_ability_1"; index: number }
  | { type: "char_ability_3"; index: number }
  | { type: "use_atium"; index: number; metalIndex: number }
  | { type: "buy_with_boxings"; index: number; card: Card; boxingsCost: number }
  | { type: "buy_elim_boxings"; index: number; card: Card; boxingsCost: number }
  | { type: "buy_boxing"; index: number }
  | { type: "use_boxing"; index: number };

// Serialized action for the frontend UI (JSON-safe, no object references)
export interface SerializedGameAction {
  type: ActionType;
  index: number;
  description: string;
  cardId?: number;
  metalIndex?: number;
  missionName?: string;
  boxingsCost?: number;
}

// ── Metal constants ──

export const METAL_NAMES = [
  "pewter",
  "tin",
  "bronze",
  "copper",
  "zinc",
  "brass",
  "iron",
  "steel",
  "atium",
] as const;

export const CHARACTERS = [
  "Kelsier",
  "Shan",
  "Vin",
  "Marsh",
  "Prodigy",
] as const;

// ── Mission tier definition ──

export type MissionRewardCode =
  | "D" | "M" | "H" | "C" | "E" | "A" | "T" | "K" | "R" | "B"
  | "Pc" | "Pd" | "Pm" | "Mi";

export interface MissionTierDef {
  threshold: number;
  reward: string;
  rewardAmount: number;
  firstReward: string;
  firstRewardAmount: number;
}

export const MISSION_TIERS: Record<string, MissionTierDef[]> = {
  "Canton Of Orthodoxy": [
    { threshold: 5, reward: "E", rewardAmount: 1, firstReward: "E", firstRewardAmount: 1 },
    { threshold: 9, reward: "E", rewardAmount: 1, firstReward: "E", firstRewardAmount: 1 },
    { threshold: 12, reward: "E", rewardAmount: 4, firstReward: "E", firstRewardAmount: 1 },
  ],
  "Luthadel Garrison": [
    { threshold: 4, reward: "D", rewardAmount: 1, firstReward: "K", firstRewardAmount: 1 },
    { threshold: 7, reward: "D", rewardAmount: 2, firstReward: "K", firstRewardAmount: 1 },
    { threshold: 10, reward: "D", rewardAmount: 3, firstReward: "K", firstRewardAmount: 1 },
    { threshold: 12, reward: "Pd", rewardAmount: 2, firstReward: "D", firstRewardAmount: 1 },
  ],
  "Keep Venture": [
    { threshold: 4, reward: "M", rewardAmount: 1, firstReward: "M", firstRewardAmount: 1 },
    { threshold: 6, reward: "M", rewardAmount: 1, firstReward: "M", firstRewardAmount: 1 },
    { threshold: 8, reward: "M", rewardAmount: 1, firstReward: "M", firstRewardAmount: 1 },
    { threshold: 10, reward: "M", rewardAmount: 1, firstReward: "M", firstRewardAmount: 1 },
    { threshold: 12, reward: "Pm", rewardAmount: 2, firstReward: "M", firstRewardAmount: 3 },
  ],
  "Skaa Caverns": [
    { threshold: 5, reward: "R", rewardAmount: 1, firstReward: "R", firstRewardAmount: 1 },
    { threshold: 9, reward: "R", rewardAmount: 1, firstReward: "R", firstRewardAmount: 1 },
    { threshold: 12, reward: "B", rewardAmount: 1, firstReward: "R", firstRewardAmount: 8 },
  ],
  "Pits Of Hathsin": [
    { threshold: 4, reward: "M", rewardAmount: 1, firstReward: "M", firstRewardAmount: 1 },
    { threshold: 8, reward: "D", rewardAmount: 2, firstReward: "H", firstRewardAmount: 2 },
    { threshold: 12, reward: "A", rewardAmount: 1, firstReward: "A", firstRewardAmount: 1 },
  ],
  "Kredik Shaw": [
    { threshold: 4, reward: "C", rewardAmount: 1, firstReward: "C", firstRewardAmount: 1 },
    { threshold: 8, reward: "C", rewardAmount: 1, firstReward: "C", firstRewardAmount: 1 },
    { threshold: 12, reward: "Pc", rewardAmount: 2, firstReward: "C", firstRewardAmount: 2 },
  ],
  "Crew Hideout": [
    { threshold: 6, reward: "H", rewardAmount: 4, firstReward: "H", firstRewardAmount: 2 },
    { threshold: 12, reward: "H", rewardAmount: 6, firstReward: "H", firstRewardAmount: 2 },
  ],
  "Luthadel Rooftops": [
    { threshold: 6, reward: "T", rewardAmount: 1, firstReward: "T", firstRewardAmount: 1 },
    { threshold: 12, reward: "T", rewardAmount: 1, firstReward: "T", firstRewardAmount: 1 },
  ],
};

export const ALL_MISSION_NAMES = Object.keys(MISSION_TIERS);

// ── Training rewards ──

export const TRAINING_REWARDS: Record<number, [string, string]> = {
  3: ["B", "1"],
  9: ["B", "1"],
  11: ["A", "1"],
  15: ["B", "1"],
  16: ["A", "1"],
};
