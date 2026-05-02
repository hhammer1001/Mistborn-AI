import { useState } from "react";

export interface SenseCard {
  id: number;
  name: string;
  blockValue: number;
  art?: string;
}

interface Props {
  senseCards: SenseCard[];
  initialRanking?: Record<number, number | null>;
  onChange: (ranking: Record<number, number | null>) => void;
}

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

/** SenseRankingPanel — defender's pre-turn ranking of which Sense cards
 *  to spend against incoming mission advances and in what order. Lowest
 *  rank fires first; "skip" leaves the card untouched. Picking a rank
 *  another card holds swaps them so the ranking stays internally
 *  consistent without per-row error states. */
export function SenseRankingPanel({ senseCards, initialRanking, onChange }: Props) {
  const [ranking, setRanking] = useState<Record<number, number | null>>(() => {
    const seed: Record<number, number | null> = {};
    for (const c of senseCards) seed[c.id] = initialRanking?.[c.id] ?? null;
    return seed;
  });

  if (senseCards.length === 0) return null;

  const totalSlots = senseCards.length;

  const setRank = (cardId: number, newRank: number | null) => {
    const next = { ...ranking };
    if (newRank !== null) {
      // Swap: if another card holds this rank, hand it the rank we
      // just vacated. Keeps ranks unique without rejecting the click.
      for (const [id, r] of Object.entries(ranking)) {
        if (r === newRank && Number(id) !== cardId) {
          next[Number(id)] = ranking[cardId] ?? null;
          break;
        }
      }
    }
    next[cardId] = newRank;
    setRanking(next);
    onChange(next);
  };

  return (
    <section className="sense-ranking" aria-label="Sense card priority">
      <div className="sense-ranking__frame">
        <span className="sense-ranking__corner sense-ranking__corner--tl" aria-hidden />
        <span className="sense-ranking__corner sense-ranking__corner--tr" aria-hidden />
        <span className="sense-ranking__corner sense-ranking__corner--bl" aria-hidden />
        <span className="sense-ranking__corner sense-ranking__corner--br" aria-hidden />

        <header className="sense-ranking__head">
          <div className="sense-ranking__eyebrow">Sense Order</div>
          <h3 className="sense-ranking__title">Burn against advances</h3>
          <p className="sense-ranking__caption">Lowest rank fires first &middot; default is skip.</p>
        </header>

        <ol className="sense-ranking__list">
          {senseCards.map((card, i) => {
            const rank = ranking[card.id] ?? null;
            return (
              <li
                key={card.id}
                className="sense-ranking__row"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="sense-ranking__identity">
                  {card.art && (
                    <span className="sense-ranking__art">
                      <img src={card.art} alt="" draggable={false} />
                    </span>
                  )}
                  <div className="sense-ranking__text">
                    <div className="sense-ranking__name">{card.name}</div>
                    <div className="sense-ranking__block">
                      blocks <strong>{card.blockValue}</strong>
                      {card.blockValue === 1 ? " mission" : " missions"}
                    </div>
                  </div>
                </div>

                <div
                  className="sense-ranking__chips"
                  role="radiogroup"
                  aria-label={`Priority for ${card.name}`}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={rank === null}
                    className={`sense-chip sense-chip--skip${rank === null ? " is-active" : ""}`}
                    onClick={() => setRank(card.id, null)}
                    title="Do not use"
                  >
                    <span className="sense-chip__mark" aria-hidden>—</span>
                  </button>
                  {Array.from({ length: totalSlots }, (_, idx) => idx + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={rank === n}
                      className={`sense-chip${rank === n ? " is-active" : ""}`}
                      onClick={() => setRank(card.id, n)}
                      title={`Burn ${ordinal(n)}`}
                    >
                      <span className="sense-chip__numeral">{roman(n)}</span>
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
