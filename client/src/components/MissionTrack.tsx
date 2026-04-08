import type { MissionData, GameAction } from "../types/game";
import { RewardIcon } from "./RewardIcon";

interface Props {
  missions: MissionData[];
  actions: GameAction[];
  onAction: (index: number) => void;
}

function MissionColumn({ mission, action, onAction }: {
  mission: MissionData;
  action?: GameAction;
  onAction: (index: number) => void;
}) {
  const you = mission.playerRanks[0];
  const opp = mission.playerRanks[1];
  const max = mission.maxRank;
  const youPct = Math.min((you / max) * 100, 100);
  const oppPct = Math.min((opp / max) * 100, 100);

  return (
    <div className="mission-col">
      <div className="mission-col-name">{mission.name}</div>

      {/* Bars with tier markers */}
      <div className="mission-bar-area">
        {/* Tier cutoff lines with rewards */}
        {mission.tiers.map((tier, i) => {
          const pct = Math.min((tier.threshold / max) * 100, 96);
          const isFinal = i === mission.tiers.length - 1;
          return (
            <div
              key={tier.threshold}
              className={`mission-cutoff${isFinal ? " final" : ""}`}
              style={{ bottom: `${pct}%` }}
            >
              <span className="mission-cutoff-rewards left">
                <RewardIcon code={tier.reward} amount={tier.rewardAmount} size={20} />
              </span>
              <span className="mission-cutoff-line" />
              <span className="mission-cutoff-rewards right">
                <RewardIcon code={tier.firstReward} amount={tier.firstRewardAmount} size={20} />
              </span>
            </div>
          );
        })}

        {/* Tick lines */}
        {Array.from({ length: max - 1 }, (_, i) => {
          const pct = ((i + 1) / max) * 100;
          return <div key={i} className="mission-bar-tick" style={{ bottom: `${pct}%` }} />;
        })}

        {/* Double bars */}
        <div className="mission-bar-col">
          <div className="mission-bar-bg">
            <div className="mission-bar-fill you" style={{ height: `${youPct}%` }} />
          </div>
          <span className="mission-bar-val you">{you}</span>
        </div>
        <div className="mission-bar-col">
          <div className="mission-bar-bg">
            <div className="mission-bar-fill opp" style={{ height: `${oppPct}%` }} />
          </div>
          <span className="mission-bar-val opp">{opp}</span>
        </div>
      </div>
      <div className="mission-col-labels">
        <span className="mission-col-label-reach">Reach</span>
        <span className="mission-col-label-first">1st</span>
      </div>
      {action && (
        <button
          className="action-btn mission-advance-btn"
          onClick={() => onAction(action.index)}
        >
          Advance
        </button>
      )}
    </div>
  );
}

export function MissionTrack({ missions, actions, onAction }: Props) {
  const missionActions = actions.filter((a) => a.code === 1);

  return (
    <div className="mission-zone">
      <h3>Missions</h3>
      <div className="mission-columns">
        {missions.map((m) => {
          const action = missionActions.find((a) => a.missionName === m.name);
          return (
            <MissionColumn
              key={m.name}
              mission={m}
              action={action}
              onAction={onAction}
            />
          );
        })}
      </div>
    </div>
  );
}
