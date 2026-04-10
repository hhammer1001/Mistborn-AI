import type { GameAction } from "../types/game";

interface Props {
  actions: GameAction[];
  onAction: (index: number) => void;
  missionRemaining: number;
}

export function ActionList({ actions, onAction, missionRemaining }: Props) {
  const endAction = actions.find((a) => a.code === 0);
  const blocked = missionRemaining > 0;

  return (
    <div className="action-list">
      {endAction && (
        <button
          className={`action-btn end-turn-btn${blocked ? " disabled" : ""}`}
          onClick={() => { if (!blocked) onAction(endAction.index); }}
          title={blocked ? `Use remaining ${missionRemaining} mission first` : ""}
        >
          End Actions{blocked ? ` (${missionRemaining} mission left)` : ""}
        </button>
      )}
    </div>
  );
}
