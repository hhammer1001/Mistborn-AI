import type { MarketData, GameAction } from "../types/game";
import { Card } from "./Card";

interface Props {
  market: MarketData;
  actions: GameAction[];
  onAction: (index: number) => void;
}

export function Market({ market, actions, onAction }: Props) {
  const getBuyActions = (cardId: number) =>
    actions.filter((a) => a.cardId === cardId && [6, 7, 13, 14].includes(a.code));

  return (
    <div className="market-zone">
      <h3>
        Market{" "}
        <span className="subtle">
          (Deck: {market.deckSize} | Discard: {market.discardSize})
        </span>
      </h3>
      <div className="card-row">
        {market.hand.map((card) => {
          const buyActions = getBuyActions(card.id);
          return (
            <div key={card.id} className="market-card-wrapper">
              <Card card={card} highlighted={buyActions.length > 0} />
              {buyActions.length > 0 && (
                <div className="card-actions">
                  {buyActions.map((a) => (
                    <button
                      key={a.index}
                      className="action-btn buy-btn"
                      onClick={() => onAction(a.index)}
                      title={a.description}
                    >
                      {a.code === 7 || a.code === 14 ? "Buy+Elim" : "Buy"}
                      {a.boxingsCost ? ` (${a.boxingsCost}B)` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
