import type { CardData } from "../types/game";

/** When the same card appears more than once in a hand, give each copy a
 *  distinguishing letter ("A", "B", "C", …) in hand order. Returns a Map
 *  keyed by cardId; cards that are unique in the hand get no entry.
 *  Funding is excluded — it stacks visually and never needs disambiguation.
 *  Letters are assigned in the order cards appear in the input array, so
 *  they match what the player sees in their hand. */
export function copyLabelsForHand(hand: CardData[]): Map<number, string> {
  const result = new Map<number, string>();
  const byName = new Map<string, CardData[]>();
  for (const c of hand) {
    if (c.type === "funding") continue;
    const arr = byName.get(c.name);
    if (arr) arr.push(c);
    else byName.set(c.name, [c]);
  }
  for (const arr of byName.values()) {
    if (arr.length <= 1) continue;
    arr.forEach((c, i) => {
      result.set(c.id, String.fromCharCode(65 + i));
    });
  }
  return result;
}

/** Append a copy label to a card name when one exists. "Charm" → "Charm A".
 *  Returns the bare name when no label is provided. */
export function nameWithCopy(name: string, copyLabel?: string): string {
  return copyLabel ? `${name} ${copyLabel}` : name;
}
