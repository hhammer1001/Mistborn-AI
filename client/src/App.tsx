import "./App.css";
import { useGame } from "./hooks/useGame";
import { GameSetup } from "./components/GameSetup";
import { Hand } from "./components/Hand";
import { Market } from "./components/Market";
import { MissionTrack } from "./components/MissionTrack";
import { MetalTokens } from "./components/MetalTokens";
import { AllyZone } from "./components/AllyZone";
import { PlayerInfo } from "./components/PlayerInfo";
import { ActionList } from "./components/ActionList";

function App() {
  const { gameState, loading, createGame, playAction } = useGame();

  const handleAction = (index: number) => {
    if (!loading) playAction(index);
  };

  // Setup screen
  if (!gameState) {
    return (
      <GameSetup
        onStart={(name, char, oppType, oppChar) =>
          createGame(name, char, oppType, oppChar)
        }
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
      {/* Top: Opponent info */}
      <div className="top-row">
        <PlayerInfo player={opp} isOpponent />
        <AllyZone allies={opp.allies} actions={[]} onAction={() => {}} label="Opponent Allies" />
      </div>

      {/* Middle: Market + Missions */}
      <div className="middle-row">
        <Market market={gameState.market} actions={actions} onAction={handleAction} />
        <MissionTrack missions={gameState.missions} actions={actions} onAction={handleAction} />
      </div>

      {/* Player area */}
      <div className="player-row">
        <div className="player-left">
          <PlayerInfo player={you} actions={actions} onAction={handleAction} />
          <MetalTokens player={you} actions={actions} onAction={handleAction} />
        </div>
        <div className="player-center">
          <AllyZone allies={you.allies} actions={actions} onAction={handleAction} label="Your Allies" />
          <Hand cards={you.hand} actions={actions} onAction={handleAction} />
        </div>
        <div className="player-right">
          <ActionList actions={actions} onAction={handleAction} />
          <div className="turn-info">
            <span>Turn {gameState.turnCount}</span>
            {loading && <span className="loading">...</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
