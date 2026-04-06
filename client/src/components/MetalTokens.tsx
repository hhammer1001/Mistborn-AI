import type { PlayerData, GameAction } from "../types/game";

interface Props {
  player: PlayerData;
  actions: GameAction[];
  onAction: (index: number) => void;
}

const TOKEN_LABELS: Record<number, string> = {
  0: "Ready",
  1: "Burned",
  2: "Flared (prev)",
  3: "Refreshed",
  4: "Flared (this)",
};

export function MetalTokens({ player, actions, onAction }: Props) {
  const burnActions = actions.filter((a) => a.code === 5);
  const atiumActions = actions.filter((a) => a.code === 12);

  return (
    <div className="metal-zone">
      <h3>
        Metals{" "}
        <span className="subtle">
          Burns: {player.burns} | Atium: {player.atium}
        </span>
      </h3>
      <div className="metal-grid">
        {player.metalNames.slice(0, 8).map((name, i) => {
          const token = player.metalTokens[i];
          const available = player.metalAvailable[i];
          const burned = player.metalBurned[i];
          const burnAction = burnActions.find((a) => a.metalIndex === i);
          const atiumAction = atiumActions.find((a) => a.metalIndex === i);

          return (
            <div
              key={name}
              className={`metal-token token-state-${token}`}
            >
              <div className="metal-name">{name}</div>
              <div className="metal-info">
                {TOKEN_LABELS[token] ?? `State ${token}`}
                {available > 0 && <span className="avail"> Avail: {available}</span>}
                {burned > 0 && <span className="burn-count"> Used: {burned}</span>}
              </div>
              <div className="metal-actions">
                {burnAction && (
                  <button
                    className="action-btn"
                    onClick={() => onAction(burnAction.index)}
                  >
                    {burnAction.description.startsWith("Burn") ? "Burn" : "Flare"}
                  </button>
                )}
                {atiumAction && (
                  <button
                    className="action-btn"
                    onClick={() => onAction(atiumAction.index)}
                  >
                    Atium
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
