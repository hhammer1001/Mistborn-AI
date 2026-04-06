import type { GameAction } from "../types/game";

interface Props {
  actions: GameAction[];
  onAction: (index: number) => void;
}

export function ActionList({ actions, onAction }: Props) {
  const endAction = actions.find((a) => a.code === 0);

  return (
    <div className="action-list">
      {endAction && (
        <button
          className="action-btn end-turn-btn"
          onClick={() => onAction(endAction.index)}
        >
          End Actions
        </button>
      )}
    </div>
  );
}
