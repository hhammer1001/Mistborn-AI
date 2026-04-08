import { useEffect, useRef } from "react";
import type { LogEntry } from "../hooks/useGame";

interface Props {
  log: LogEntry[];
}

export function ActivityLog({ log }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log.length]);

  // Group entries by turn
  let currentTurn = -1;

  return (
    <div className="activity-log">
      <h3>Activity Log</h3>
      <div className="activity-log-scroll">
        {log.map((entry, i) => {
          const showTurn = entry.turn !== currentTurn;
          currentTurn = entry.turn;
          return (
            <div key={i}>
              {showTurn && (
                <div className="log-turn-header">Turn {entry.turn}</div>
              )}
              <div className={`log-entry${entry.isBot ? " log-bot" : ""}`}>
                {entry.text}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
