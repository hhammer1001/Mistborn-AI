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

export const BOT_TYPES = ["anvil", "hulk", "squashV2", "zoom", "squash", "twonky", "synergy", "random"] as const;
export type BotType = (typeof BOT_TYPES)[number];

/** Display label for each bot type (shown in menus, logs, opponent name). */
export const BOT_TYPE_LABELS: Record<BotType, string> = {
  anvil:    "Anvil",
  hulk:     "Hulk X90",
  squashV2: "Hammer Bot",
  zoom:     "Zoom Bot",
  squash:   "Squash Bot",
  twonky:   "Twonky",
  synergy:  "Synergy Bot",
  random:   "Random Bot",
};

/** Short, colloquial blurb shown next to the bot picker in the setup menu. */
export const BOT_TYPE_BLURBS: Record<BotType, string> = {
  anvil:    "Hulk's successor — evolved buy policies plus a learned win-odds model that overrides its play on big strategic calls. Beats Hulk head-to-head.",
  hulk:     "Best of both worlds — Hammer Bot when going first, Zoom Bot when going second.",
  squashV2: "The strongest going-first bot. Thinks a move ahead and pounces when it sees lethal.",
  zoom:     "Going-second specialist. Wins by spotting angles the opponent overlooked.",
  squash:   "Scores every move and plays the best one. Solid all-arounder — beats Twonky about three games out of four.",
  twonky:   "The original Mistborn AI. Follows a hardcoded priority list it learned from playing itself.",
  synergy:  "Buys cards that pair well with the ones already in its deck. Built around synergy, not raw card value.",
  random:   "Picks moves at random. Useful for chaos or quick testing.",
};

export function botLabel(t: string): string {
  return (BOT_TYPE_LABELS as Record<string, string>)[t]
    ?? (t.charAt(0).toUpperCase() + t.slice(1) + " Bot");
}

export const VICTORY_TYPES = ["Mission", "Combat", "Confrontation", "Forfeit"] as const;
export type VictoryType = (typeof VICTORY_TYPES)[number];

export const CHARACTERS = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"] as const;
export const CHARACTER_OPTIONS = ["Random", ...CHARACTERS] as const;
