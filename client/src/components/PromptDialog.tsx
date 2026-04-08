import type { GamePrompt, PromptOption } from "../types/game";

const EFFECT_NAMES: Record<string, string> = {
  D: "Damage", M: "Money", H: "Heal", C: "Draw", E: "Eliminate",
  A: "Atium", T: "Train", K: "Kill Ally", R: "Refresh", B: "+Burn",
  Mi: "Mission", Pc: "+Draw", Pd: "+Dmg", Pm: "+Money",
};

const METAL_DISPLAY: Record<string, string> = {
  pewter: "Pewter", tin: "Tin", bronze: "Bronze", copper: "Copper",
  zinc: "Zinc", brass: "Brass", iron: "Iron", steel: "Steel",
};

function optionLabel(opt: PromptOption): string {
  if (opt.source === "skip") return "Skip";
  if (opt.metal) return METAL_DISPLAY[opt.metal as string] ?? String(opt.metal);
  if (opt.effect && opt.amount) {
    const name = EFFECT_NAMES[opt.effect as string] ?? String(opt.effect);
    return `${name} ${opt.amount}`;
  }
  if (opt.name) {
    const source = opt.source && opt.source !== "skip" ? ` (${opt.source})` : "";
    const cost = opt.cost !== undefined ? ` — cost ${opt.cost}` : "";
    return `${opt.name}${cost}${source}`;
  }
  return `Option ${opt.index}`;
}

interface Props {
  prompt: GamePrompt;
  onRespond: (promptType: string, value: number) => void;
}

export function PromptDialog({ prompt, onRespond }: Props) {
  return (
    <div className="prompt-overlay">
      <div className="prompt-dialog">
        <div className="prompt-title">{prompt.context || "Choose"}</div>
        <div className="prompt-options">
          {prompt.options.map((opt) => (
            <button
              key={opt.index}
              className={`prompt-option-btn${opt.source === "skip" ? " prompt-skip" : ""}`}
              onClick={() => onRespond(prompt.type, opt.index)}
            >
              {optionLabel(opt)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
