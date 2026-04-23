import { METAL_ICONS } from "./metalIcons";

const ATIUM_FLAT   = "/cards/atium token.png";
const ATIUM_FLARED = "/ministry/atium-flared.png";

export interface MetalSigil {
  key: string;
  label: string;
  flat: string;
  ringed: string;
}

export const MINISTRY_METALS: MetalSigil[] = [
  { key: "pewter", label: "Pewter", flat: METAL_ICONS.pewter.flat, ringed: METAL_ICONS.pewter.ringed },
  { key: "tin",    label: "Tin",    flat: METAL_ICONS.tin.flat,    ringed: METAL_ICONS.tin.ringed },
  { key: "bronze", label: "Bronze", flat: METAL_ICONS.bronze.flat, ringed: METAL_ICONS.bronze.ringed },
  { key: "copper", label: "Copper", flat: METAL_ICONS.copper.flat, ringed: METAL_ICONS.copper.ringed },
  { key: "zinc",   label: "Zinc",   flat: METAL_ICONS.zinc.flat,   ringed: METAL_ICONS.zinc.ringed },
  { key: "brass",  label: "Brass",  flat: METAL_ICONS.brass.flat,  ringed: METAL_ICONS.brass.ringed },
  { key: "iron",   label: "Iron",   flat: METAL_ICONS.iron.flat,   ringed: METAL_ICONS.iron.ringed },
  { key: "steel",  label: "Steel",  flat: METAL_ICONS.steel.flat,  ringed: METAL_ICONS.steel.ringed },
  { key: "atium",  label: "Atium",  flat: ATIUM_FLAT,              ringed: ATIUM_FLARED },
];

export const MINISTRY_SYMBOL_SRC = "/ministry/symbol.png";

export const BOT_TYPES = ["squash", "twonky", "synergy", "random", "hammer"] as const;
export type BotType = (typeof BOT_TYPES)[number];

export const VICTORY_TYPES = ["Mission", "Combat", "Confrontation", "Forfeit"] as const;
export type VictoryType = (typeof VICTORY_TYPES)[number];

export const CHARACTERS = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"] as const;
export const CHARACTER_OPTIONS = ["Random", ...CHARACTERS] as const;
