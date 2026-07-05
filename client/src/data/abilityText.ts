/** Translates engine effect codes into human-readable ability descriptions. */

const EFFECT_NAMES: Record<string, string> = {
  D: "Damage",
  M: "Money",
  H: "Heal",
  C: "Draw",
  E: "Eliminate",
  A: "Atium",
  T: "Train",
  K: "Kill Ally",
  R: "Refresh",
  B: "+1 Burn",
  Mi: "Mission",
  Pc: "+1 Hand Size",
  Pd: "+1 Perm Damage",
  Pm: "+1 Perm Money",
};

/** Full-text descriptions for special abilities, keyed by code */
const SPECIAL_TEXT: Record<string, string> = {
  special1:  "Gain 1 Money for every Mission track you are the lowest on",
  special2:  "Move up 1 on every Mission you are the lowest on",
  special3:  "Draw a card for each Mission track you are the highest on",
  special4:  "Gain 3 Damage for each Mission track you are the highest on",
  special5:  "If you are the lowest on any Mission track, draw a card",
  special6:  "Lose all Damage. Gain Mission equal to the amount lost",
  special7:  "Lose all Mission. Gain Damage equal to the amount lost",
  special8:  "Gain a card in the market costing up to 5 to your discard pile",
  special9:  "You may buy an eliminated card",
  special10: "Gain an eliminated card to your hand",
  special11: "Kill all opponent's Allies and eliminate all cards in the market",
  special12: "Play the top ability of an eliminated card",
  special13: "You win",
  special14: "Look at the top card of your deck. Eliminate it or put it back",
  special15: "Set aside a card from your hand. Draw it at the start of your next turn",
  special16: "Use the top ability of the same Action again",
  special17: "Gain an eliminated card to your discard pile",
  special:   "Reduce all damage you take by 1",
};

/** Text builders for active (off-turn) abilities. `n` is the card's active
 *  amount; non-positive amounts (cloudA carries a meaningless "-1" in the
 *  data) simply omit the numeric clause. */
const ACTIVE_TEXT: Record<string, (n: number) => string> = {
  sense:  (n) => `Reveal when the opponent advances a mission to block it${n > 0 ? ` (they lose ${n} Mission)` : ""}`,
  cloudP: (n) => `Play off-turn to reduce incoming Damage to you${n > 0 ? ` by ${n}` : ""}`,
  cloudA: () => "Play off-turn to prevent one of your Allies from being killed",
};

function effectName(code: string): string {
  return EFFECT_NAMES[code] ?? code;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Parse a compound effect like "D.H" / "2.1" into readable text */
function parseCompound(effect: string, amount: string): string {
  if (effect === "choose") {
    const inner = amount.replace(/[()]/g, "");
    const parts = inner.split("/");
    const choices: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      choices.push(`${effectName(parts[i])} ${parts[i + 1]}`);
    }
    return `Choose: ${choices.join(" or ")}`;
  }

  const effects = effect.split(".");
  const amounts = amount.split(".");
  const parts: string[] = [];

  for (let i = 0; i < effects.length; i++) {
    const e = effects[i];
    const a = amounts[i] ?? "0";

    // Check for special text
    if (SPECIAL_TEXT[e]) {
      parts.push(SPECIAL_TEXT[e]);
      continue;
    }
    // Named effects that carry their own sentence — previously these fell
    // through to the raw code when nested in a compound ("D.pull" → "pull").
    if (e === "seek") { parts.push(seekText(a)); continue; }
    if (e === "pull") { parts.push(pullText(a)); continue; }
    if (e === "push") { parts.push(pushText(a)); continue; }
    if (e === "riot") { parts.push(riotText(a)); continue; }
    if (e === "choose") { parts.push(parseCompound("choose", a)); continue; }

    const name = EFFECT_NAMES[e];
    if (!name) {
      parts.push(e); // unknown code, show raw
      continue;
    }

    const num = parseInt(a);
    if (num === 0) continue;
    parts.push(`${name} ${a}`);
  }

  return parts.join(", ") || effect;
}

/** Describe seek effect. Negative amounts are engine flags: -6 = pick two
 *  different Actions (Pierce), -5 = mark the pick as sought (Seeker). */
function seekText(amount: string): string {
  const raw = parseInt(amount);
  const n = Math.abs(raw);
  if (raw === -6) return `Use the top ability of two different Actions in the market costing ${n} or less`;
  if (raw === -5) return `Use the top ability of an Action in the market costing ${n} or less and mark it as sought`;
  return `Use the top ability of an Action in the market costing ${n} or less`;
}

/** Describe pull effect */
function pullText(amount: string): string {
  const n = parseInt(amount);
  return `Move ${n === 1 ? "a card" : `up to ${n} cards`} from discard to top of deck`;
}

/** Describe push effect */
function pushText(amount: string): string {
  const n = parseInt(amount);
  return `Eliminate ${n === 1 ? "a card" : `${n} cards`} from the market`;
}

/** Describe riot effect */
function riotText(_amount: string): string {
  return "Activate the top ability of one of your unused Allies";
}

/** Top-level parser for an effect+amount pair, returns human text */
function describeEffect(effect: string, amount: string): string {
  // Handle single-token special effects
  if (SPECIAL_TEXT[effect]) return SPECIAL_TEXT[effect];
  if (effect === "seek") return seekText(amount);
  if (effect === "pull") return pullText(amount);
  if (effect === "push") return pushText(amount);
  if (effect === "riot") return riotText(amount);
  if (effect === "choose") return parseCompound(effect, amount);

  // Compound effects (D.H, M.special1, etc.)
  return parseCompound(effect, amount);
}

export interface AbilityLine {
  label: string;
  text: string;
}

export function describeCard(card: {
  name: string;
  type: string;
  cost: number;
  metalName?: string;
  capacity?: number;
  health?: number;
  defender?: boolean;
  abilities?: { effect: string; amount: string }[];
  abilitySlots?: ({ effect: string; amount: string } | null)[];
  activeAbility?: { effect: string; amount: string };
  burnAbility?: { effect: string; amount: string };
}): AbilityLine[] {
  const lines: AbilityLine[] = [];
  const metal = card.metalName ? capitalize(card.metalName) : "";

  if (card.type === "funding") {
    lines.push({ label: "", text: "Gain 1 Money" });
    return lines;
  }

  if (card.type === "action") {
    // Label abilities by their RAW slot index — the engine fires slot N on
    // the Nth metal use, so a card with a gap (ability1 + ability3, no
    // ability2) needs its slot-3 effect labeled "+ 2", not "+ 1". Prefer
    // abilitySlots (positional, nulls for gaps); fall back to the compacted
    // abilities list for callers that don't have slots.
    const slots = card.abilitySlots ?? card.abilities ?? [];
    slots.forEach((slot, i) => {
      if (!slot) return;
      lines.push({
        label: i === 0 ? (metal || "Play") : `+ ${i} ${metal}`,
        text: describeEffect(slot.effect, slot.amount),
      });
    });
    // Active/ongoing ability
    if (card.activeAbility) {
      const key = card.activeAbility.effect;
      const amt = card.activeAbility.amount;
      const build = ACTIVE_TEXT[key];
      if (build) {
        lines.push({ label: "Ongoing", text: build(parseInt(amt, 10)) });
      } else {
        lines.push({ label: "Ongoing", text: describeEffect(key, amt) });
      }
    }
    // Burn ability
    if (card.burnAbility) {
      lines.push({ label: "Burn", text: describeEffect(card.burnAbility.effect, card.burnAbility.amount) });
    }
  }

  if (card.type === "ally") {
    // Hardcoded play effects for specific allies
    if (card.name === "Noble") lines.push({ label: "On Play", text: "+1 Burn token" });
    if (card.name === "Crewleader") lines.push({ label: "On Play", text: "+1 Hand size (permanent)" });
    if (card.name === "Smoker") lines.push({ label: "Ongoing", text: "Reduce all damage you take by 1" });

    if (card.abilities) {
      if (card.abilities[0]) {
        lines.push({ label: metal || "Ability", text: describeEffect(card.abilities[0].effect, card.abilities[0].amount) });
      }
      if (card.abilities[1]) {
        lines.push({ label: `+ 1 ${metal}`, text: describeEffect(card.abilities[1].effect, card.abilities[1].amount) });
      }
    }
  }

  return lines;
}
