import type { CardData, GameAction } from "../types/game";
import { Card } from "./Card";

interface Props {
  cards: CardData[];
  actions: GameAction[];
  onAction: (index: number) => void;
}

export function Hand({ cards, actions, onAction }: Props) {
  const getCardActions = (cardId: number) =>
    actions.filter((a) => a.cardId === cardId);

  return (
    <div className="hand-zone">
      <h3>Your Hand</h3>
      <div className="card-row">
        {cards.map((card) => {
          const cardActions = getCardActions(card.id);
          const hasActions = cardActions.length > 0;
          return (
            <div key={card.id} className="hand-card-wrapper">
              <Card card={card} highlighted={hasActions} />
              {hasActions && (
                <div className="card-actions">
                  {cardActions.map((a) => (
                    <button
                      key={a.index}
                      className="action-btn"
                      onClick={() => onAction(a.index)}
                      title={a.description}
                    >
                      {shortLabel(a)}
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

function shortLabel(action: GameAction): string {
  switch (action.code) {
    case 2:
      return "Burn";
    case 3:
      return "Refresh";
    case 4:
      return "Use Metal";
    default:
      return action.description.split(" ").slice(0, 2).join(" ");
  }
}
