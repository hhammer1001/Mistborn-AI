// Character-specific card ratings: Record<cardName, [wins, total, winRate]>
// The Twonky bot uses index [2] (winRate) as the card's quality score.

import Kelsier3 from "./Kelsier3.json";
import Marsh3 from "./Marsh3.json";
import Shan3 from "./Shan3.json";
import Vin3 from "./Vin3.json";
import Prodigy3 from "./Prodigy3.json";
import twonkyMissionData from "./twonkyMissionData.json";
import categor2 from "./categor2.json";

export type CardRatings = Record<string, number[]>;
export type MissionRatings = Record<string, number>;
export type CategoryData = Record<string, Record<string, number[]>>;

export const CHARACTER_CARD_RATINGS: Record<string, CardRatings> = {
  Kelsier: Kelsier3 as CardRatings,
  Marsh: Marsh3 as CardRatings,
  Shan: Shan3 as CardRatings,
  Vin: Vin3 as CardRatings,
  Prodigy: Prodigy3 as CardRatings,
};

// Per-character buffer values (how good a card needs to be to buy)
export const CHARACTER_BUFFERS: Record<string, number> = {
  Kelsier: 0.04,
  Marsh: 0.25,
  Shan: -0.16,
  Vin: 0.09,
  Prodigy: -0.16,
};

export const MISSION_RATINGS = twonkyMissionData as MissionRatings;
export const CATEGORY_DATA = categor2 as CategoryData;
