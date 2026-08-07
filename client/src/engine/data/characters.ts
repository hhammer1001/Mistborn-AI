import type { CharacterDef } from "../types";

// Ability I is gated on burning the character's metal; ability III on burning
// atium. Ability II ("when you buy a card you may resolve its top effect
// immediately, then eliminate it") is identical on every card and lives in
// player.ts as the buy_eliminate action rather than as data.

export const CHARACTER_DEFS: Record<string, CharacterDef> = {
  "Marsh":   {"name": "Marsh",   "ability1Metal": 2, "ability1Effect": "Mi",    "ability1Amount": "1",     "ability3Effect": "D.Mi", "ability3Amount": "3.3"},
  "Vin":     {"name": "Vin",     "ability1Metal": 0, "ability1Effect": "H.D.M", "ability1Amount": "1.1.1", "ability3Effect": "D.Mi", "ability3Amount": "3.3"},
  "Shan":    {"name": "Shan",    "ability1Metal": 4, "ability1Effect": "M",     "ability1Amount": "2",     "ability3Effect": "D.Mi", "ability3Amount": "3.3"},
  "Kelsier": {"name": "Kelsier", "ability1Metal": 7, "ability1Effect": "D",     "ability1Amount": "2",     "ability3Effect": "D.Mi", "ability3Amount": "3.3"},
  "Prodigy": {"name": "Prodigy", "displayName": "Vin", "title": "The Prodigy", "ability1Metal": 5, "ability1Effect": "E", "ability1Amount": "1", "ability3Effect": "D.Mi", "ability3Amount": "3.3"},

  // ── Expansion characters ──
  "Empress": {"name": "Empress", "displayName": "Vin",   "title": "The Empress",    "ability1Metal": 6, "ability1Effect": "pull",        "ability1Amount": "1", "ability3Effect": "D",  "ability3Amount": "6"},
  "Zane":    {"name": "Zane",    "displayName": "Zane",  "title": "The Watcher",    "ability1Metal": 3, "ability1Effect": "R",           "ability1Amount": "1", "ability3Effect": "A",  "ability3Amount": "1"},
  "Kar":     {"name": "Kar",     "displayName": "Kar",   "title": "The Inquisitor", "ability1Metal": 1, "ability1Effect": "discardDraw", "ability1Amount": "1", "ability3Effect": "Mi", "ability3Amount": "4"},
  "Elend":   {"name": "Elend",   "displayName": "Elend", "title": "The Emperor",    "ability1Metal": 5, "ability1Effect": "H.Bx",        "ability1Amount": "1.1", "ability3Effect": "C", "ability3Amount": "2"},
};

/** Card name as printed — "Vin, The Empress" rather than the engine key. */
export function characterLabel(key: string): string {
  const def = CHARACTER_DEFS[key];
  if (!def) return key;
  const name = def.displayName ?? def.name;
  return def.title ? `${name}, ${def.title}` : name;
}
