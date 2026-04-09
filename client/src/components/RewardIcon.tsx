/**
 * RewardIcon — renders a mission/training reward as an extracted game icon
 * with an optional numeric overlay.
 *
 * Usage:
 *   <RewardIcon code="D" amount={2} size={24} />
 *   <RewardIcon code="B" size={18} />        // no number overlay
 */

const ICON_MAP: Record<string, { src: string; label: string }> = {
  D:  { src: "swords",    label: "Damage" },
  M:  { src: "coin",      label: "Money" },
  H:  { src: "heal",      label: "Heal" },
  C:  { src: "draw_1",    label: "Draw" },
  E:  { src: "eliminate",  label: "Eliminate" },
  A:  { src: "atium",     label: "Atium" },
  R:  { src: "refresh_2", label: "Refresh" },
  B:  { src: "burn",    label: "Burn" },
  K:  { src: "__kill__",   label: "Kill Ally" },
  T:  { src: "cloak_1",   label: "Train" },
  Pc: { src: "draw_1",    label: "+Draw" },
  Pd: { src: "swords",    label: "+Damage" },
  Pm: { src: "coin",      label: "+Money" },
};

/** Icons that have pre-baked number variants (e.g. swords_1.png, coin_2.png) */
const NUMBERED_VARIANTS: Record<string, number[]> = {
  swords:    [1, 2, 3],
  coin:      [1, 2, 3],
  heal:      [2, 4, 6],
  eliminate: [1, 2],
};

/** Default icon file to use when no numbered variant matches */
const DEFAULT_FILE: Record<string, string> = {
  swords:    "swords_1",
  coin:      "coin_1",
  heal:      "heal_2",
  eliminate: "eliminate_1",
};

function iconPath(base: string, amount?: number): string {
  const variants = NUMBERED_VARIANTS[base];
  if (variants && amount && variants.includes(amount)) {
    return `/cards/icons/${base}_${amount}.png`;
  }
  const fallback = DEFAULT_FILE[base] ?? base;
  return `/cards/icons/${fallback}.png`;
}

interface Props {
  /** Reward code from the game engine (D, M, H, C, E, A, R, B, K, T, Pc, Pd, Pm) */
  code: string;
  /** Numeric amount — used to pick a numbered icon variant or display as overlay */
  amount?: number;
  /** Icon diameter in px (default 24) */
  size?: number;
  className?: string;
}

export function RewardIcon({ code, amount, size = 24, className }: Props) {
  const entry = ICON_MAP[code];
  if (!entry) {
    return (
      <span
        className={`reward-icon reward-icon-fallback ${className ?? ""}`}
        style={{ width: size, height: size, fontSize: size * 0.5 }}
        title={`${code} ${amount ?? ""}`}
      >
        {code}
      </span>
    );
  }

  // Special rendering for Kill Ally — red "K" circle
  if (code === "K") {
    return (
      <span
        className={`reward-icon reward-icon-kill ${className ?? ""}`}
        style={{ width: size, height: size, fontSize: size * 0.55 }}
        title="Kill Ally — Destroy an opponent's Ally"
      >
        K
      </span>
    );
  }

  const variants = NUMBERED_VARIANTS[entry.src];
  const hasVariant = variants && amount && variants.includes(amount);
  const src = iconPath(entry.src, amount);

  // Show numeric overlay when there's an amount but no pre-baked variant
  // Burn icon already has "+1" baked in
  const showOverlay = amount !== undefined && amount > 0 && !hasVariant
    && !(code === "B" && amount === 1);
  const isPermanent = code.startsWith("P") && code.length === 2;
  const overlayText = showOverlay
    ? isPermanent ? `${amount}P` : `${amount}`
    : null;

  return (
    <span
      className={`reward-icon ${className ?? ""}`}
      style={{ width: size, height: size }}
      title={`${entry.label}${amount ? ` ${amount}` : ""}`}
    >
      <img
        src={src}
        alt={entry.label}
        className="reward-icon-img"
        width={size}
        height={size}
        draggable={false}
      />
      {overlayText && (
        <span className="reward-icon-number" style={{ fontSize: size * 0.65 }}>
          {overlayText}
        </span>
      )}
    </span>
  );
}
