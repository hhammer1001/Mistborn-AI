/** Sprite sheet metadata and card-name → position lookup for in-game card rendering. */

const P = "/cards/httpssteamusercontentaakamaihdnetugc";

export interface Sheet {
  src: string;
  cols: number;
  rows: number;
  w: number;
  h: number;
}

export interface CardSprite {
  sheet: Sheet;
  col: number;
  row: number;
  rotated?: boolean; // true = stored 90° CW, display landscape
}

export const CREW_SHEET: Sheet = {
  src: `${P}10307375962418354840C29207AC69F8AA63CF05D2C21F6DD4C08D8207E9.jpg`,
  cols: 10, rows: 3, w: 7680, h: 3212,
};

export const DECK_SHEET: Sheet = {
  src: `${P}13135413059729423061344DC892AC987C52EB68024EB7CB51612AAEA7C8.jpg`,
  cols: 10, rows: 5, w: 7680, h: 5365,
};

export const TRAIN_SHEET: Sheet = {
  src: `${P}115369065496175734263557006D91E26EC106890A39303332327D47F4DB.jpg`,
  cols: 5, rows: 4, w: 6517, h: 7244,
};

// ── Card name → sprite position ────────────────────────────────────────────

const SPRITES: Record<string, CardSprite> = {
  // Allies (CREW_SHEET, rotated 90° CW)
  "Rebel":       { sheet: CREW_SHEET, col: 0, row: 0, rotated: true },
  "Pewterarm":   { sheet: CREW_SHEET, col: 1, row: 0, rotated: true },
  "Obligator":   { sheet: CREW_SHEET, col: 2, row: 0, rotated: true },
  "Noble":       { sheet: CREW_SHEET, col: 3, row: 0, rotated: true },
  "Mercenary":   { sheet: CREW_SHEET, col: 4, row: 0, rotated: true },
  "Lurcher":     { sheet: CREW_SHEET, col: 5, row: 0, rotated: true },
  "Keeper":      { sheet: CREW_SHEET, col: 6, row: 0, rotated: true },
  "Kandra":      { sheet: CREW_SHEET, col: 7, row: 0, rotated: true },
  "Rioter":      { sheet: CREW_SHEET, col: 8, row: 0, rotated: true },
  "Smoker":      { sheet: CREW_SHEET, col: 9, row: 0, rotated: true },
  "Pickpocket":  { sheet: CREW_SHEET, col: 0, row: 1, rotated: true },
  "Inquisitor":  { sheet: CREW_SHEET, col: 1, row: 1, rotated: true },
  "Informant":   { sheet: CREW_SHEET, col: 2, row: 1, rotated: true },
  "Houselord":   { sheet: CREW_SHEET, col: 3, row: 1, rotated: true },
  "Hazekillers": { sheet: CREW_SHEET, col: 4, row: 1, rotated: true },
  "Crewleader":  { sheet: CREW_SHEET, col: 5, row: 1, rotated: true },
  "Coinshot":    { sheet: CREW_SHEET, col: 6, row: 1, rotated: true },
  "Soldier":     { sheet: CREW_SHEET, col: 7, row: 1, rotated: true },
  "Soother":     { sheet: CREW_SHEET, col: 8, row: 1, rotated: true },
  "Tineye":      { sheet: CREW_SHEET, col: 9, row: 1, rotated: true },
  "Seeker":      { sheet: CREW_SHEET, col: 0, row: 2, rotated: true },

  // Actions (DECK_SHEET, upright)
  "Unveil":          { sheet: DECK_SHEET, col: 0, row: 0 },
  "Train In Secret": { sheet: DECK_SHEET, col: 1, row: 0 },
  "Survive":         { sheet: DECK_SHEET, col: 2, row: 0 },
  "Subdue":          { sheet: DECK_SHEET, col: 3, row: 0 },
  "Strike":          { sheet: DECK_SHEET, col: 4, row: 0 },
  "Strategize":      { sheet: DECK_SHEET, col: 5, row: 0 },
  "Steelpush":       { sheet: DECK_SHEET, col: 6, row: 0 },
  "Spy":             { sheet: DECK_SHEET, col: 7, row: 0 },
  "Soar":            { sheet: DECK_SHEET, col: 8, row: 0 },
  "Sneak":           { sheet: DECK_SHEET, col: 9, row: 0 },
  "Ruin":            { sheet: DECK_SHEET, col: 0, row: 1 },
  "Rescue":          { sheet: DECK_SHEET, col: 1, row: 1 },
  "Reposition":      { sheet: DECK_SHEET, col: 2, row: 1 },
  "Recover":         { sheet: DECK_SHEET, col: 3, row: 1 },
  "Pursue":          { sheet: DECK_SHEET, col: 4, row: 1 },
  "Preserve":        { sheet: DECK_SHEET, col: 5, row: 1 },
  "Precise Shot":    { sheet: DECK_SHEET, col: 6, row: 1 },
  "Pierce":          { sheet: DECK_SHEET, col: 7, row: 1 },
  "Pacify":          { sheet: DECK_SHEET, col: 8, row: 1 },
  "Maelstrom":       { sheet: DECK_SHEET, col: 9, row: 1 },
  "Lookout":         { sheet: DECK_SHEET, col: 0, row: 2 },
  "Ironpull":        { sheet: DECK_SHEET, col: 1, row: 2 },
  "Investigate":     { sheet: DECK_SHEET, col: 2, row: 2 },
  "Intimidate":      { sheet: DECK_SHEET, col: 3, row: 2 },
  "Inspire":         { sheet: DECK_SHEET, col: 4, row: 2 },
  "Infiltrate":      { sheet: DECK_SHEET, col: 5, row: 2 },
  "Hyperaware":      { sheet: DECK_SHEET, col: 6, row: 2 },
  "Hunt":            { sheet: DECK_SHEET, col: 7, row: 2 },
  "House War":       { sheet: DECK_SHEET, col: 8, row: 2 },
  "Hide":            { sheet: DECK_SHEET, col: 9, row: 2 },
  "Con":             { sheet: DECK_SHEET, col: 0, row: 3 },
  "Ascendant":       { sheet: DECK_SHEET, col: 1, row: 3 },
  "Assassinate":     { sheet: DECK_SHEET, col: 2, row: 3 },
  "Balance":         { sheet: DECK_SHEET, col: 3, row: 3 },
  "Brawl":           { sheet: DECK_SHEET, col: 4, row: 3 },
  "Charm":           { sheet: DECK_SHEET, col: 5, row: 3 },
  "Confrontation":   { sheet: DECK_SHEET, col: 6, row: 3 },
  "Coppercloud":     { sheet: DECK_SHEET, col: 7, row: 3 },
  "Crash":           { sheet: DECK_SHEET, col: 8, row: 3 },
  "Crushing Blow":   { sheet: DECK_SHEET, col: 9, row: 3 },
  "Enrage":          { sheet: DECK_SHEET, col: 0, row: 4 },
  "Eavesdrop":       { sheet: DECK_SHEET, col: 1, row: 4 },
  "Dominate":        { sheet: DECK_SHEET, col: 2, row: 4 },
  "Deceive":         { sheet: DECK_SHEET, col: 3, row: 4 },

  // Training cards (TRAIN_SHEET, upright)
  "Zinc Training":   { sheet: TRAIN_SHEET, col: 0, row: 0 },
  "Tin Training":    { sheet: TRAIN_SHEET, col: 1, row: 0 },
  "Copper Training": { sheet: TRAIN_SHEET, col: 2, row: 0 },
  "Steel Training":  { sheet: TRAIN_SHEET, col: 3, row: 0 },
  "Bronze Training": { sheet: TRAIN_SHEET, col: 0, row: 1 },
  "Iron Training":   { sheet: TRAIN_SHEET, col: 1, row: 1 },
  "Brass Training":  { sheet: TRAIN_SHEET, col: 2, row: 1 },
  "Pewter Training": { sheet: TRAIN_SHEET, col: 3, row: 1 },

  // Funding (TRAIN_SHEET)
  "Funding":         { sheet: TRAIN_SHEET, col: 4, row: 0 },
};

export function getCardSprite(name: string): CardSprite | undefined {
  return SPRITES[name];
}
