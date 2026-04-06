import type { CardData, GameAction } from "../types/game";
import { Card } from "./Card";

interface Props {
  allies: CardData[];
  actions: GameAction[];
  onAction: (index: number) => void;
  label: string;
}

export function AllyZone({ allies, actions, onAction, label }: Props) {
  if (allies.length === 0) return null;

  const getAllyActions = (cardId: number) =>
    actions.filter((a) => a.cardId === cardId && [8, 9].includes(a.code));

  return (
    <div className="ally-zone">
      <h3>{label}</h3>
      <div className="card-row">
        {allies.map((ally) => {
          const allyActions = getAllyActions(ally.id);
          return (
            <div key={ally.id} className="ally-card-wrapper">
              <Card card={ally} highlighted={allyActions.length > 0} small />
              {allyActions.length > 0 && (
                <div className="card-actions">
                  {allyActions.map((a) => (
                    <button
                      key={a.index}
                      className="action-btn"
                      onClick={() => onAction(a.index)}
                    >
                      {a.code === 8 ? "Ability 1" : "Ability 2"}
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
