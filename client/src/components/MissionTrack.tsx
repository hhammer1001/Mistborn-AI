import type { MissionData, GameAction } from "../types/game";

interface Props {
  missions: MissionData[];
  actions: GameAction[];
  onAction: (index: number) => void;
}

export function MissionTrack({ missions, actions, onAction }: Props) {
  const missionActions = actions.filter((a) => a.code === 1);

  return (
    <div className="mission-zone">
      <h3>Missions</h3>
      <div className="mission-list">
        {missions.map((m) => {
          const action = missionActions.find((a) => a.missionName === m.name);
          const yourRank = m.playerRanks[0];
          const oppRank = m.playerRanks[1];
          const pct = Math.min((yourRank / m.maxRank) * 100, 100);

          return (
            <div key={m.name} className="mission-item">
              <div className="mission-header">
                <span className="mission-name">{m.name}</span>
                {action && (
                  <button
                    className="action-btn mission-btn"
                    onClick={() => onAction(action.index)}
                  >
                    Advance
                  </button>
                )}
              </div>
              <div className="mission-bar-container">
                <div className="mission-bar you" style={{ width: `${pct}%` }} />
                <div
                  className="mission-bar opp"
                  style={{
                    width: `${Math.min((oppRank / m.maxRank) * 100, 100)}%`,
                  }}
                />
              </div>
              <div className="mission-ranks">
                You: {yourRank}/{m.maxRank} | Opp: {oppRank}/{m.maxRank}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
