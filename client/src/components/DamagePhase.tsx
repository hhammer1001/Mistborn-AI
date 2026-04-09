import type { DamageTarget } from "../types/game";

interface Props {
  damage: number;
  targets: DamageTarget[];
  onAssign: (targetIndex: number) => void;
}

export function DamagePhase({ damage, targets, onAssign }: Props) {
  return (
    <div className="damage-phase">
      <h3>Damage Phase</h3>
      <p className="damage-phase-total">
        You have <strong>{damage}</strong> damage to assign
      </p>
      {targets.length > 0 && (
        <div className="damage-phase-targets">
          <p>Kill an opponent's ally:</p>
          {targets.map((t) => (
            <button
              key={t.cardId}
              className="action-btn damage-target-btn"
              onClick={() => onAssign(t.index)}
            >
              Kill {t.name} ({t.health} HP)
            </button>
          ))}
        </div>
      )}
      <button
        className="action-btn damage-done-btn"
        onClick={() => onAssign(-1)}
      >
        Deal {damage} damage to opponent
      </button>
    </div>
  );
}
