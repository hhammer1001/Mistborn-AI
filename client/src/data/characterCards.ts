/** Character card art + card-derived display data, keyed by engine character
 *  key. Single source for every surface that shows a character: PlayerInfo,
 *  OpponentDetailPopup, the lobby picker and the card gallery. */

import { CHARACTER_DEFS, characterLabel } from "../engine/data/characters";
import { RANDOM_ANY, RANDOM_NEW } from "./ministrySigils";

const P = "/cards/httpssteamusercontentaakamaihdnetugc";

export const CHARACTER_IMAGES: Record<string, string> = {
  Kelsier: `${P}96933575893836348543557D24AEEE1F012C3CAD29954EF6814E760FC9D.jpg`,
  Vin:     `${P}1345520488082639487110C19C4ACDC3BB4A6DED9A5BF2E459BE380AC1E6.jpg`,
  Marsh:   `${P}109539518916106846249A7A17D9C6BE1C03FF4CA5B6C5F9A8955B0722D3.jpg`,
  Shan:    `${P}175380882799496743833A2ED5F67A4F055DBA77817F4E1E3182320AC66E.jpg`,
  Prodigy: "/cards/Vin%20Prodigy%20copy.png",
  Empress: "/cards/vin-empress.png",
  Zane:    "/cards/zane-watcher.png",
  Kar:     "/cards/kar-inquisitor.png",
  Elend:   "/cards/elend-emperor.png",
};

/** Metal index gating each character's ability I. Derived from the card data
 *  so a new character never needs a second edit here. */
export const CHARACTER_METAL: Record<string, number> = Object.fromEntries(
  Object.values(CHARACTER_DEFS).map((d) => [d.name, d.ability1Metal]),
);

export { characterLabel };

/** Label for anything that can appear in a character dropdown, including the
 *  "Random" sentinels (which aren't characters and have no card of their own). */
export function characterOptionLabel(value: string): string {
  if (value === RANDOM_ANY) return "Random";
  if (value === RANDOM_NEW) return "Random (new only)";
  return characterLabel(value);
}
