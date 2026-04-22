import { useState } from "react";
import type { GameState, PlayerData } from "../types/game";
import type { LogEntry } from "../hooks/useGame";
import { ActivityLog } from "./ActivityLog";
import { PostgameDetailPopup } from "./PostgameDetailPopup";

interface Props {
  gameState: GameState;
  you: PlayerData;
  opp: PlayerData;
  log: LogEntry[];
  youWon: boolean;
  backLabel: string;
  onBack: () => void;
}

const VICTORY_LABEL: Record<string, string> = {
  M: "by Mission",
  D: "by Combat",
  T: "as Time Ran Out",
  C: "by Confrontation",
  F: "by Forfeit",
};

export function GameOverScreen({ gameState, you, opp, log, youWon, backLabel, onBack }: Props) {
  const [showDetails, setShowDetails] = useState(false);
  const outcome = youWon ? "Victorious" : "Defeated";
  const tone = youWon ? "win" : "loss";
  const victoryPhrase = VICTORY_LABEL[gameState.victoryType ?? ""] ?? gameState.victoryType ?? "—";

  return (
    <div className={`gg-scene gg-${tone}`}>
      <div className="gg-ash" aria-hidden>
        {Array.from({ length: 40 }).map((_, i) => (
          <span key={i} style={{ left: `${(i * 2.5 + (i % 7) * 3) % 100}%`, animationDelay: `${(i % 11) * 0.6}s`, animationDuration: `${10 + (i % 6) * 3}s` }} />
        ))}
      </div>

      <header className="gg-header">
        <div className="gg-eyebrow">
          <span className="gg-eyebrow-rule" />
          <span>Final Empire · Chronicle {gameState.turnCount}</span>
          <span className="gg-eyebrow-rule" />
        </div>
        <h1 className="gg-outcome" data-text={outcome}>{outcome}</h1>
        <p className="gg-subtitle">
          {youWon
            ? <>You overcame <em>{opp.name}</em>, {victoryPhrase.toLowerCase()}.</>
            : <><em>{opp.name}</em> prevailed {victoryPhrase.toLowerCase()}.</>}
        </p>
      </header>

      <section className="gg-inscription" aria-label="Summary">
        <Inscription label="Outcome" value={victoryPhrase} />
        <Inscription label="Turns" value={String(gameState.turnCount)} />
        <Inscription label={`${you.name} HP`} value={String(you.health)} tone={you.health > 0 ? "ok" : "down"} />
        <Inscription label={`${opp.name} HP`} value={String(opp.health)} tone={opp.health > 0 ? "ok" : "down"} />
      </section>

      <main className="gg-chronicle">
        <div className="gg-chronicle-label">
          <span>The Chronicle</span>
          <span className="gg-chronicle-rule" />
        </div>
        <ActivityLog log={log} />
      </main>

      <footer className="gg-actions">
        <button className="gg-btn gg-btn-ghost" onClick={() => setShowDetails(true)}>
          <span>Inspect the Final Board</span>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
        <button className="gg-btn gg-btn-primary" onClick={onBack}>{backLabel}</button>
      </footer>

      {showDetails && (
        <PostgameDetailPopup
          gameState={gameState}
          you={you}
          opp={opp}
          onClose={() => setShowDetails(false)}
        />
      )}
    </div>
  );
}

function Inscription({ label, value, tone }: { label: string; value: string; tone?: "ok" | "down" }) {
  return (
    <div className={`gg-inscr${tone ? ` gg-inscr-${tone}` : ""}`}>
      <span className="gg-inscr-label">{label}</span>
      <span className="gg-inscr-value">{value}</span>
    </div>
  );
}
