import type { CardData } from "../types/game";

interface Props {
  card: CardData;
  onClick?: () => void;
  highlighted?: boolean;
  small?: boolean;
}

export function Card({ card, onClick, highlighted, small }: Props) {
  const typeClass = `card card-${card.type}${highlighted ? " card-highlighted" : ""}${small ? " card-small" : ""}`;

  return (
    <div className={typeClass} onClick={onClick} title={card.name}>
      <div className="card-header">
        <span className="card-name">{card.name}</span>
        <span className="card-cost">{card.cost}</span>
      </div>
      <div className="card-body">
        <span className="card-metal">{card.metalName}</span>
        {card.type === "action" && (
          <div className="card-status">
            {card.burned && <span className="badge burned">Burned</span>}
            {(card.metalUsed ?? 0) > 0 && (
              <span className="badge">
                {card.metalUsed}/{card.capacity}
              </span>
            )}
          </div>
        )}
        {card.type === "ally" && (
          <div className="card-status">
            <span className="badge">HP: {card.health}</span>
            {card.defender && <span className="badge defender">Defender</span>}
          </div>
        )}
        {card.abilities && card.abilities.length > 0 && (
          <div className="card-abilities">
            {card.abilities.map((a, i) => (
              <div key={i} className="ability">
                {a.effect}: {a.amount}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
