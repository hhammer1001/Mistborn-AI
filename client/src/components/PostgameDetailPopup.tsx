import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { GameState, PlayerData, CardData } from "../types/game";
import { PlayerInfo } from "./PlayerInfo";
import { TrainingTrack } from "./TrainingTrack";
import { MetalTokens } from "./MetalTokens";
import { MissionTrack } from "./MissionTrack";
import { Card } from "./Card";

interface Props {
  gameState: GameState;
  you: PlayerData;
  opp: PlayerData;
  onClose: () => void;
}

/** Merge hand + discard + deck into a single list sorted by card name. */
function combineDeck(p: PlayerData): CardData[] {
  const all = [
    ...(p.hand ?? []),
    ...(p.discard ?? []),
    ...(p.deck ?? []),
  ];
  return all.slice().sort((a, b) => a.name.localeCompare(b.name));
}

function PlayerColumn({ player, label, alignment }: {
  player: PlayerData;
  label: string;
  alignment: "left" | "right";
}) {
  const fullDeck = useMemo(() => combineDeck(player), [player]);
  return (
    <div className={`pg-col pg-col-${alignment}`}>
      <div className="pg-col-label">
        <span className="pg-col-flag" /> {label}
      </div>
      <div className="player-info-with-training">
        <PlayerInfo player={player} />
        <TrainingTrack training={player.training} character={player.character} />
        <MetalTokens player={player} actions={[]} onAction={() => {}} />
      </div>
      {(player.allies?.length ?? 0) > 0 && (
        <div className="pg-cards">
          <div className="pg-cards-head">
            <h4>Allies in Play</h4>
            <span className="pg-cards-count">{player.allies.length}</span>
          </div>
          <div className="pg-cards-scroll">
            {player.allies.map((c, i) => (
              <Card key={`${c.id}-${i}`} card={c} baseWidth={110} />
            ))}
          </div>
        </div>
      )}
      <div className="pg-cards">
        <div className="pg-cards-head">
          <h4>Full Deck</h4>
          <span className="pg-cards-count">{fullDeck.length}</span>
        </div>
        {fullDeck.length === 0 ? (
          <p className="pg-cards-empty">No cards.</p>
        ) : (
          <div className="pg-cards-scroll">
            {fullDeck.map((c, i) => (
              <Card key={`${c.id}-${i}`} card={c} baseWidth={110} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function PostgameDetailPopup({ gameState, you, opp, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="pg-overlay" onClick={onClose}>
      <div className="pg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="pg-panel-header">
          <div className="pg-panel-title">
            <span className="pg-panel-rule" />
            <h3>Final Board</h3>
            <span className="pg-panel-rule" />
          </div>
          <button className="pg-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="pg-missions">
          <MissionTrack
            missions={gameState.missions}
            actions={[]}
            onAction={() => {}}
            onAdvanceAll={() => {}}
            missionPoints={0}
          />
        </div>
        <div className="pg-players">
          <PlayerColumn player={you} label={`${you.name} — you`} alignment="left" />
          <PlayerColumn player={opp} label={opp.name} alignment="right" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
