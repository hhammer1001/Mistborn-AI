import { CHARACTERS } from "./types";

/** Which characters a training run should cover.
 *
 *  Defaults to the full roster. Set `CHARS=Empress,Zane` to restrict the run —
 *  the generators write one file per character, so restricting the loop extends
 *  a table with new characters while leaving the entries already trained for the
 *  established roster untouched. Regenerating those would reshuffle weights the
 *  shipped bots are calibrated against, for no benefit.
 *
 *  Read off globalThis rather than `process` directly: the training harnesses
 *  run under tsx but are excluded from the app tsconfig, which has no node types.
 */
export function trainingChars(varName = "CHARS"): string[] {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[varName];
  if (!env) return [...CHARACTERS];

  const want = env.split(",").map((s) => s.trim()).filter(Boolean);
  const unknown = want.filter((c) => !(CHARACTERS as readonly string[]).includes(c));
  if (unknown.length > 0) {
    throw new Error(
      `${varName} names unknown character(s): ${unknown.join(", ")}. ` +
      `Known: ${CHARACTERS.join(", ")}`,
    );
  }
  return want;
}
