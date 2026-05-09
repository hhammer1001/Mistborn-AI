import { useState } from "react";
import type React from "react";
import { EyeIcon } from "./icons/EyeIcon";
import { FlameIcon } from "./icons/FlameIcon";
import { CardImagePopup } from "./CardImagePopup";

const BURN_DURATION_MS = 700;

export interface RankingCard {
  id: number;
  name: string;
  blockValue: number;
  art?: string;
}

export type RankingVariant = "sense" | "cloud";

interface VariantCopy {
  eyebrow: { rank: string; toggle: string };
  title: { rank: string; toggle: string };
  captionDefault: { rank: string; toggle: string };
  unitSingular: string;
  unitPlural: string;
}

const COPY: Record<RankingVariant, VariantCopy> = {
  sense: {
    eyebrow: { rank: "Sense Order", toggle: "Sense Defense" },
    title: { rank: "Burn against advances", toggle: "Block this advance?" },
    captionDefault: {
      rank: "Lowest rank fires first · default is skip.",
      toggle: "Spend a Sense card to negate it.",
    },
    unitSingular: "mission",
    unitPlural: "missions",
  },
  cloud: {
    eyebrow: { rank: "Cloud Order", toggle: "Cloud Defense" },
    title: { rank: "Burn against damage", toggle: "Reduce incoming damage" },
    captionDefault: {
      rank: "Lowest rank fires first · default is skip.",
      toggle: "Spend a cloud to absorb part of the hit.",
    },
    unitSingular: "damage",
    unitPlural: "damage",
  },
};

type RankProps = {
  mode: "rank";
  initialRanking?: Record<number, number | null>;
  onChange: (ranking: Record<number, number | null>) => void;
};

type ToggleProps = {
  mode: "toggle";
  /** Called once when the player commits via Submit. `selectedIds` is the
   *  set of toggled-on cards (empty array = take the damage / let the
   *  advance through). Engine wiring decides whether multi-card commits
   *  are processed in sequence. */
  onSubmit: (selectedIds: number[]) => void;
  submitLabel?: string;
  /** Live status line shown at the bottom of the panel — reflects what the
   *  current toggle selection would do if Submit were clicked right now. */
  formatStatus?: (selected: RankingCard[]) => React.ReactNode;
};

const sumBlock = (selected: RankingCard[]) =>
  selected.reduce((sum, c) => sum + c.blockValue, 0);

const defaultFormatStatus = (variant: RankingVariant) =>
  (selected: RankingCard[]): React.ReactNode => {
    const pool = sumBlock(selected);
    if (variant === "cloud") {
      return selected.length === 0
        ? <>not smoking — taking the full hit</>
        : <>smoking <strong>{selected.length}</strong>, blocking <strong>{pool}</strong></>;
    }
    return <><strong>{pool}</strong> currently in pool</>;
  };

type Props = {
  variant: RankingVariant;
  cards: RankingCard[];
  caption?: string;
} & (RankProps | ToggleProps);

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const roman = (n: number): string => ROMAN[n - 1] ?? String(n);

const ordinal = (n: number): string => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
};

/** RankingPanel — wax-sealed defensive panel.
 *
 *  rank mode: pre-turn priority for sense vs. mission advances (PvE only —
 *  bot turns run synchronously and can't pause mid-advance for a per-prompt).
 *  Lowest rank fires first; "skip" leaves the card untouched. Picking a rank
 *  another card holds swaps them so ranks stay unique without per-row errors.
 *
 *  toggle mode: in-the-moment "use which one?" decision used during turns.
 *  Sense PvP fires per advance; cloud fires per damage event. Each card
 *  shows its block value so the player can see the trade before committing,
 *  which the old per-card-button modal didn't make obvious. */
export function RankingPanel(props: Props) {
  const { variant, cards, caption } = props;
  const copy = COPY[variant];

  // useState must be unconditional, so always call it; only consumed when mode === "rank".
  const [ranking, setRanking] = useState<Record<number, number | null>>(() => {
    const seed: Record<number, number | null> = {};
    for (const c of cards) seed[c.id] = props.mode === "rank" ? props.initialRanking?.[c.id] ?? null : null;
    return seed;
  });
  const [zoomName, setZoomName] = useState<string | null>(null);
  // Toggle-mode staged selection — multi-select set of card ids the player
  // has toggled on but not yet committed.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  // Cards currently playing the burn animation after Submit. Animations
  // resolve before onSubmit fires so the player visually confirms the spend.
  const [burningIds, setBurningIds] = useState<Set<number>>(() => new Set());
  const [committed, setCommitted] = useState(false);

  const toggleCard = (cardId: number) => {
    if (committed) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  const submit = () => {
    if (props.mode !== "toggle" || committed) return;
    setCommitted(true);
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      props.onSubmit([]);
      setCommitted(false);
      return;
    }
    setBurningIds(new Set(ids));
    window.setTimeout(() => {
      props.onSubmit(ids);
      setBurningIds(new Set());
      setSelectedIds(new Set());
      setCommitted(false);
    }, BURN_DURATION_MS);
  };

  const setRank = (cardId: number, newRank: number | null) => {
    if (props.mode !== "rank") return;
    const next = { ...ranking };
    if (newRank !== null) {
      for (const [id, r] of Object.entries(ranking)) {
        if (r === newRank && Number(id) !== cardId) {
          next[Number(id)] = ranking[cardId] ?? null;
          break;
        }
      }
    }
    next[cardId] = newRank;
    setRanking(next);
    props.onChange(next);
  };

  const totalSlots = cards.length;
  const eyebrow = copy.eyebrow[props.mode];
  const title = copy.title[props.mode];
  const captionText = caption ?? copy.captionDefault[props.mode];

  return (
    <section
      className={`ranking-panel ranking-panel--${variant}`}
      aria-label={`${eyebrow}`}
    >
      <div className="ranking-panel__frame">
        <span className="ranking-panel__corner ranking-panel__corner--tl" aria-hidden />
        <span className="ranking-panel__corner ranking-panel__corner--tr" aria-hidden />
        <span className="ranking-panel__corner ranking-panel__corner--bl" aria-hidden />
        <span className="ranking-panel__corner ranking-panel__corner--br" aria-hidden />

        <header className="ranking-panel__head">
          <div className="ranking-panel__eyebrow">{eyebrow}</div>
          <h3 className="ranking-panel__title">{title}</h3>
          <p className="ranking-panel__caption">{captionText}</p>
        </header>

        <ol className="ranking-panel__list">
          {cards.map((card, i) => {
            const rank = ranking[card.id] ?? null;
            const unit = card.blockValue === 1 ? copy.unitSingular : copy.unitPlural;
            return (
              <li
                key={card.id}
                className={`ranking-panel__row${burningIds.has(card.id) ? " is-burning" : ""}${selectedIds.has(card.id) ? " is-selected" : ""}`}
                style={{ animationDelay: burningIds.has(card.id) ? undefined : `${i * 60}ms` }}
              >
                <div className="ranking-panel__identity">
                  {card.art && (
                    <span className="ranking-panel__art">
                      <img src={card.art} alt="" draggable={false} />
                    </span>
                  )}
                  <div className="ranking-panel__text">
                    <div className="ranking-panel__name">
                      <span>{card.name}</span>
                      <button
                        type="button"
                        className="ranking-panel__eye log-eye"
                        aria-label={`Show ${card.name} card`}
                        onClick={(e) => { e.stopPropagation(); setZoomName(card.name); }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setZoomName(card.name); }}
                      >
                        <EyeIcon />
                      </button>
                    </div>
                    <div className="ranking-panel__block">
                      blocks <strong>{card.blockValue}</strong> {unit}
                    </div>
                  </div>
                </div>

                {props.mode === "rank" ? (
                  <div
                    className="ranking-panel__chips"
                    role="radiogroup"
                    aria-label={`Priority for ${card.name}`}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={rank === null}
                      className={`ranking-chip ranking-chip--skip${rank === null ? " is-active" : ""}`}
                      onClick={() => setRank(card.id, null)}
                      title="Do not use"
                    >
                      <span className="ranking-chip__mark" aria-hidden>—</span>
                    </button>
                    {Array.from({ length: totalSlots }, (_, idx) => idx + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={rank === n}
                        className={`ranking-chip${rank === n ? " is-active" : ""}`}
                        onClick={() => setRank(card.id, n)}
                        title={`Burn ${ordinal(n)}`}
                      >
                        <span className="ranking-chip__numeral">{roman(n)}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`ranking-toggle${selectedIds.has(card.id) ? " is-on" : ""}`}
                    onClick={() => toggleCard(card.id)}
                    disabled={committed}
                    aria-pressed={selectedIds.has(card.id)}
                    aria-label={`Toggle burn ${card.name}`}
                  >
                    <span className="ranking-toggle__track" aria-hidden>
                      <span className="ranking-toggle__icon ranking-toggle__icon--off">—</span>
                      <span className="ranking-toggle__icon ranking-toggle__icon--on">
                        <FlameIcon size={11} />
                      </span>
                      <span className="ranking-toggle__knob" />
                    </span>
                    <span className="ranking-toggle__label">Burn</span>
                  </button>
                )}
              </li>
            );
          })}
        </ol>

        {props.mode === "rank" && (
          <div className="ranking-panel__status" aria-live="polite">
            <strong>
              {cards.reduce((sum, c) => sum + (ranking[c.id] != null ? c.blockValue : 0), 0)}
            </strong>{" "}
            {copy.unitSingular} blocked
          </div>
        )}

        {props.mode === "toggle" && (
          <>
            <div className="ranking-panel__status" aria-live="polite">
              {(props.formatStatus ?? defaultFormatStatus(variant))(
                cards.filter((c) => selectedIds.has(c.id)),
              )}
            </div>
            <button
              type="button"
              className="ranking-pill ranking-pill--submit"
              onClick={submit}
              disabled={committed}
            >
              {props.submitLabel ?? "Submit"}
            </button>
          </>
        )}
      </div>
      {zoomName && <CardImagePopup name={zoomName} onClose={() => setZoomName(null)} />}
    </section>
  );
}
