import { useState } from "react";
import "./App.css";
import { useGame } from "./hooks/useGame";
import { GameSetup } from "./components/GameSetup";
import { CardGallery } from "./components/CardGallery";
import { Hand } from "./components/Hand";
import { Market } from "./components/Market";
import { MissionTrack } from "./components/MissionTrack";
import { MetalTokens } from "./components/MetalTokens";
import { AllyZone } from "./components/AllyZone";
import { PlayerInfo } from "./components/PlayerInfo";
import { ActionList } from "./components/ActionList";
import { TrainingTrack } from "./components/TrainingTrack";
import { ActivityLog } from "./components/ActivityLog";
import { PromptDialog } from "./components/PromptDialog";

function App() {
  const { gameState, loading, log, createGame, playAction, respondToPrompt } = useGame();
  const [showGallery, setShowGallery] = useState(false);

  const handleAction = (index: number) => {
    if (!loading) playAction(index);
  };

  // Setup / gallery screen
  if (!gameState) {
    if (showGallery) {
      return <CardGallery onBack={() => setShowGallery(false)} />;
    }
    return (
      <GameSetup
        onStart={(name, char, oppType, oppChar) =>
          createGame(name, char, oppType, oppChar)
        }
        onViewCards={() => setShowGallery(true)}
      />
    );
  }

  const you = gameState.players[0];
  const opp = gameState.players[1];
  const actions = gameState.availableActions;

  // Game over screen
  if (gameState.phase === "game_over") {
    return (
      <div className="game-over">
        <h1>Game Over</h1>
        <h2>
          {gameState.winner === you.name ? "You Win!" : `${gameState.winner} Wins`}
        </h2>
        <p>Victory: {gameState.victoryType} | Turns: {gameState.turnCount}</p>
        <p>Your HP: {you.health} | Opponent HP: {opp.health}</p>
        <button onClick={() => window.location.reload()}>New Game</button>
      </div>
    );
  }

  return (
    <div className="game-board">
      <div className="board-left">
        <div className="left-main">
          <div className="left-top-row">
            <div className="player-info-with-training">
              <PlayerInfo player={you} actions={actions} onAction={handleAction} />
              <TrainingTrack training={you.training} character={you.character} />
              <MetalTokens player={you} actions={actions} onAction={handleAction} />
            </div>
            <Market market={gameState.market} actions={actions} onAction={handleAction} />
          </div>
          <AllyZone allies={you.allies} actions={actions} onAction={handleAction} label="Your Allies" />
          <Hand cards={you.hand} actions={actions} onAction={handleAction} deckSize={you.deckSize} discardSize={you.discardSize} />
        </div>
      </div>
      <div className="board-right">
        <PlayerInfo player={opp} isOpponent />
        <AllyZone allies={opp.allies} actions={[]} onAction={() => {}} label="Opponent Allies" />
        <MissionTrack missions={gameState.missions} actions={actions} onAction={handleAction} />
        <ActivityLog log={log} />
        <div className="right-footer">
          <ActionList actions={actions} onAction={handleAction} />
          <div className="turn-info">
            <span>Turn {gameState.turnCount}</span>
            {loading && <span className="loading">...</span>}
          </div>
          <button className="main-menu-btn" onClick={() => window.location.reload()}>
            Main Menu
          </button>
        </div>
      </div>
      {gameState.prompt && (
        <PromptDialog
          prompt={gameState.prompt}
          onRespond={(type, value) => respondToPrompt(type, value)}
        />
      )}
    </div>
  );
}

export default App;
