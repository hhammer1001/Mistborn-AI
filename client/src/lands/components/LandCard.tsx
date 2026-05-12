import type { LandCard as LandCardData, LandType } from "../engine/types";

const ART: Record<LandType, string> = {
  plains: "/cards/basic-lands/plains.png",
  island: "/cards/basic-lands/island.png",
  swamp: "/cards/basic-lands/swamp.png",
  mountain: "/cards/basic-lands/mountain.png",
  forest: "/cards/basic-lands/forest.png",
};

/** Scryfall mana-symbol SVGs (W/U/B/R/G), one per basic-land type. */
const MANA_ICON: Record<LandType, string> = {
  plains: "/cards/basic-lands/mana-W.svg",
  island: "/cards/basic-lands/mana-U.svg",
  swamp: "/cards/basic-lands/mana-B.svg",
  mountain: "/cards/basic-lands/mana-R.svg",
  forest: "/cards/basic-lands/mana-G.svg",
};

/** Renders the mana symbol for a land type. */
export function ManaIcon({
  type,
  size = 14,
  title,
}: {
  type: LandType;
  size?: number;
  title?: string;
}) {
  return (
    <img
      className="lands-mana-icon"
      src={MANA_ICON[type]}
      alt={type}
      width={size}
      height={size}
      title={title ?? type}
      draggable={false}
    />
  );
}

const CARD_BACK = "/cards/basic-lands/card-back.png";

export type CardSize = "sm" | "md" | "lg";

interface Props {
  card: LandCardData;
  size?: CardSize;
  faceDown?: boolean;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  /** Show an eye icon overlay — signals "the opponent knows this card". */
  showRevealedIcon?: boolean;
}

export function LandCard({
  card,
  size = "md",
  faceDown,
  selected,
  disabled,
  onClick,
  title,
  showRevealedIcon,
}: Props) {
  const cls = [
    "lands-card",
    `lands-card-${size}`,
    selected ? "lands-card-selected" : "",
    disabled ? "lands-card-disabled" : "",
    onClick && !disabled ? "lands-card-clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={cls}
      onClick={!disabled && onClick ? onClick : undefined}
      title={title ?? (faceDown ? "Card back" : card.type)}
    >
      <img
        src={faceDown ? CARD_BACK : ART[card.type]}
        alt={faceDown ? "card back" : card.type}
        draggable={false}
      />
      {showRevealedIcon && !faceDown && (
        <span className="lands-card-eye" aria-label="visible to opponent" title="Opponent has seen this card">
          {/* Eye glyph — kept as inline SVG so it scales cleanly with the card. */}
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
            <path
              fill="currentColor"
              d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
            />
          </svg>
        </span>
      )}
    </div>
  );
}

/** Compact pile representation: a card-back with a count badge in the corner.
 *  Inlining the count keeps the pile within the card's vertical footprint, so
 *  it can sit alongside the in-play row without overflowing into adjacent
 *  rows. */
export function FaceDownPile({
  count,
  label,
  size = "sm",
}: {
  count: number;
  label?: string;
  size?: CardSize;
}) {
  return (
    <div className={`lands-pile lands-pile-${size}`} title={label ? `${label}: ${count}` : `${count}`}>
      <div className="lands-pile-stack">
        {count > 0 ? (
          <>
            <div className={`lands-pile-back lands-card-${size}`} style={{ backgroundImage: `url(${CARD_BACK})` }} />
            {count > 1 && <div className={`lands-pile-back lands-pile-back-2 lands-card-${size}`} style={{ backgroundImage: `url(${CARD_BACK})` }} />}
            {count > 2 && <div className={`lands-pile-back lands-pile-back-3 lands-card-${size}`} style={{ backgroundImage: `url(${CARD_BACK})` }} />}
            <div className="lands-pile-badge">{count}</div>
          </>
        ) : (
          <div className={`lands-pile-empty lands-card-${size}`}>{label?.toLowerCase() ?? "empty"}</div>
        )}
      </div>
    </div>
  );
}
