import { RewardIcon } from "./RewardIcon";

const CHARACTER_COLORS: Record<string, string> = {
  Vin: "#e04040",
  Prodigy: "#e04040",
  Kelsier: "#4a7abf",
  Shan: "#d4b55a",
  Marsh: "#9060c0",
};

const TRAINING_MILESTONES: {
  level: number;
  rewardCode?: string;
  icon: string;
  tip: string;
  type: string;
}[] = [
  { level: 3,  rewardCode: "B", icon: "B",   tip: "+1 Burn",           type: "burn" },
  { level: 5,                    icon: "I",   tip: "Char. Ability I",   type: "ability" },
  { level: 8,                    icon: "II",  tip: "Buy + Eliminate",    type: "ability" },
  { level: 9,  rewardCode: "B", icon: "B",   tip: "+1 Burn",           type: "burn" },
  { level: 11, rewardCode: "A", icon: "A",   tip: "+1 Atium",          type: "atium" },
  { level: 13,                   icon: "III", tip: "Char. Ability III",  type: "ability" },
  { level: 15, rewardCode: "B", icon: "B",   tip: "+1 Burn",           type: "burn" },
  { level: 16, rewardCode: "A", icon: "A",   tip: "+1 Atium",          type: "atium" },
];

interface Props {
  training: number;
  character: string;
}

export function TrainingTrack({ training, character }: Props) {
  const maxDisplay = 18;
  const color = CHARACTER_COLORS[character] ?? "#c9a44a";
  const fillPct = Math.min((training / maxDisplay) * 100, 100);

  return (
    <div className="training-track-zone">
      <div className="training-track-header">
        <h3>Train</h3>
        <span className="training-level">{training}</span>
      </div>
      <div className="training-vertical">
        <div className="training-v-bar">
          <div className="training-v-fill" style={{ height: `${fillPct}%`, background: color }} />
          {/* Level tick lines */}
          {Array.from({ length: maxDisplay - 1 }, (_, i) => {
            const pct = ((i + 1) / maxDisplay) * 100;
            return <div key={i} className="training-v-tick" style={{ bottom: `${pct}%` }} />;
          })}
          {/* Cube marker */}
          <div
            className="training-v-cube"
            style={{
              bottom: `${fillPct}%`,
              background: color,
              boxShadow: `0 0 6px ${color}80`,
            }}
          />
          {/* Milestone markers */}
          {TRAINING_MILESTONES.map((m) => {
            const pct = (m.level / maxDisplay) * 100;
            const reached = m.level <= training;
            return (
              <div
                key={m.level}
                className="training-v-milestone"
                style={{ bottom: `${pct}%` }}
                title={`${m.level}: ${m.tip}`}
              >
                {m.rewardCode ? (
                  <RewardIcon code={m.rewardCode} size={18} className={reached ? "reached" : ""} />
                ) : (
                  <span className={`training-v-marker marker-${m.type}${reached ? " reached" : ""}`}>
                    {m.icon}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
