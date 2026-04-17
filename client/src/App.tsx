import { useState } from "react";
import "./App.css";
import { useGame } from "./hooks/useGame";
import { useAuth } from "./hooks/useAuth";
import { useLobby } from "./hooks/useLobby";
import { useMultiplayerGame } from "./hooks/useMultiplayerGame";
import { MultiplayerGameSession } from "./engine/multiplayerSession";
import { db, id as instantId } from "./lib/instantdb";
import { GameSetup } from "./components/GameSetup";
import { CardGallery } from "./components/CardGallery";
import { AuthScreen } from "./components/AuthScreen";
import { Lobby } from "./components/Lobby";
import { WaitingOverlay } from "./components/WaitingOverlay";
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
import { DamagePhase } from "./components/DamagePhase";
import type { GameState } from "./types/game";

type AppMode = "menu" | "gallery" | "bot_game" | "auth" | "lobby" | "mp_game";

function App() {
  const [mode, setMode] = useState<AppMode>("menu");
  const [mpSessionId, setMpSessionId] = useState<string | null>(null);

  // Bot game hook (always active for simplicity, only used in bot_game mode)
  const botGame = useGame();

  // Auth
  const auth = useAuth();

  // Lobby (only meaningful when authed)
  const lobby = useLobby(auth.user?.id, auth.profile?.name);

  // Multiplayer game
  const mpGame = useMultiplayerGame(mpSessionId, auth.user?.id ?? null);

  // ── Menu / Gallery ──
  if (mode === "menu") {
    return (
      <GameSetup
        onStart={(name, char, oppType, oppChar, botFirst, testDeck) => {
          botGame.createGame(name, char, oppType, oppChar, botFirst, testDeck);
          setMode("bot_game");
        }}
        onViewCards={() => setMode("gallery")}
        onPlayOnline={() => {
          if (auth.user) {
            setMode("lobby");
          } else {
            setMode("auth");
          }
        }}
      />
    );
  }

  if (mode === "gallery") {
    return <CardGallery onBack={() => setMode("menu")} />;
  }

  // ── Auth ──
  if (mode === "auth") {
    if (auth.isLoading) {
      return <div className="game-setup"><h1>Loading...</h1></div>;
    }
    if (auth.user) {
      // Already authed, go to lobby
      setMode("lobby");
      return null;
    }
    return (
      <AuthScreen
        onSendCode={async (email) => { await auth.sendMagicCode(email); }}
        onLogin={async (email, code) => {
          await auth.verifyMagicCode(email, code);
          // After login, ensure profile exists — use email prefix as default name
          const defaultName = email.split("@")[0];
          auth.ensureProfile(defaultName);
          setMode("lobby");
        }}
        error={auth.error}
      />
    );
  }

  // ── Lobby ──
  if (mode === "lobby") {
    // Check if room transitioned to in_game
    if (lobby.room?.status === "in_game" && lobby.room.sessionId) {
      if (mpSessionId !== lobby.room.sessionId) {
        setMpSessionId(lobby.room.sessionId);
        setMode("mp_game");
        return null;
      }
    }

    const handleStartGame = async () => {
      if (!lobby.room || !auth.user) return;
      try {
        // Create game session locally
        const session = new MultiplayerGameSession(
          lobby.room.hostName,
          lobby.room.hostCharacter,
          lobby.room.guestName,
          lobby.room.guestCharacter,
        );

        const gameId = instantId();
        const payload = session.getInstantDBPayload();

        // Write initial state to InstantDB
        await db.transact(
          db.tx.games[gameId].update({
            roomId: lobby.room.id,
            ...payload,
            p0Id: lobby.room.hostId,
            p1Id: lobby.room.guestId,
            stateVersion: 0,
          })
        );

        // Update room status
        await db.transact(
          db.tx.rooms[lobby.room.id].update({
            status: "in_game",
            sessionId: gameId,
          })
        );

        // Store session ref for the active player
        mpGame.sessionRef.current = session;
        setMpSessionId(gameId);
        setMode("mp_game");
      } catch (e) {
        console.error("Failed to start game:", e);
      }
    };

    return (
      <Lobby
        room={lobby.room}
        myRole={lobby.myRole as "host" | "guest" | null}
        error={lobby.error}
        isLoading={lobby.isLoading}
        onCreateRoom={lobby.createRoom}
        onJoinRoom={lobby.joinRoom}
        onSelectCharacter={lobby.selectCharacter}
        onReady={lobby.setReady}
        onLeave={() => {
          lobby.leaveRoom();
        }}
        onStartGame={handleStartGame}
        onBack={() => setMode("menu")}
      />
    );
  }

  // ── Bot Game ──
  if (mode === "bot_game") {
    return (
      <BotGameBoard
        game={botGame}
        onMainMenu={() => {
          setMode("menu");
          window.location.reload();
        }}
      />
    );
  }

  // ── Multiplayer Game ──
  if (mode === "mp_game") {
    return (
      <MultiplayerGameBoard
        game={mpGame}
        onMainMenu={() => {
          setMpSessionId(null);
          lobby.leaveRoom();
          setMode("menu");
        }}
      />
    );
  }

  return null;
}

// ── Bot Game Board (existing behavior, extracted) ──

function BotGameBoard({
  game,
  onMainMenu,
}: {
  game: ReturnType<typeof useGame>;
  onMainMenu: () => void;
}) {
  const { gameState, loading, log, playAction, advanceAllMission, playTwoActions, assignDamage, resolveSense, resolveCloud, respondToPrompt, undo, canUndo } = game;

  const handleAction = (index: number) => {
    if (!loading) playAction(index);
  };

  if (!gameState) {
    return <div className="game-setup"><h1>Loading...</h1></div>;
  }

  const you = gameState.players[0];
  const opp = gameState.players[1];
  const actions = gameState.availableActions;

  if (gameState.phase === "game_over") {
    return (
      <div className="game-over">
        <h1>Game Over</h1>
        <h2>{gameState.winner === you.name ? "You Win!" : `${gameState.winner} Wins`}</h2>
        <p>Victory: {gameState.victoryType} | Turns: {gameState.turnCount}</p>
        <p>Your HP: {you.health} | Opponent HP: {opp.health}</p>
        <button onClick={onMainMenu}>New Game</button>
      </div>
    );
  }

  return (
    <GameBoard
      gameState={gameState}
      you={you}
      opp={opp}
      actions={actions}
      loading={loading}
      log={log}
      isMyTurn={true}
      handleAction={handleAction}
      playTwoActions={playTwoActions}
      advanceAllMission={advanceAllMission}
      assignDamage={assignDamage}
      resolveSense={resolveSense}
      resolveCloud={resolveCloud}
      respondToPrompt={respondToPrompt}
      onMainMenu={onMainMenu}
      onUndo={undo}
      canUndo={canUndo}
    />
  );
}

// ── Multiplayer Game Board ──

function MultiplayerGameBoard({
  game,
  onMainMenu,
}: {
  game: ReturnType<typeof useMultiplayerGame>;
  onMainMenu: () => void;
}) {
  const { gameState, loading, log, isMyTurn, myPlayerIndex, playAction, advanceAllMission, playTwoActions, assignDamage, resolveSense, resolveCloud, respondToPrompt, forfeit } = game;

  const handleAction = (index: number) => {
    if (!loading && isMyTurn) playAction(index);
  };

  if (!gameState) {
    return <div className="game-setup"><h1>Loading game...</h1></div>;
  }

  const mi = myPlayerIndex ?? 0;
  const you = gameState.players[mi];
  const opp = gameState.players[1 - mi];
  const actions = isMyTurn ? gameState.availableActions : [];

  if (gameState.phase === "game_over") {
    const iWon = gameState.isWinner ?? (gameState.winner === you.name);
    return (
      <div className="game-over">
        <h1>Game Over</h1>
        <h2>{iWon ? "You Win!" : `${opp.name} Wins`}</h2>
        <p>Victory: {gameState.victoryType} | Turns: {gameState.turnCount}</p>
        <p>Your HP: {you.health} | Opponent HP: {opp.health}</p>
        <button onClick={onMainMenu}>Main Menu</button>
      </div>
    );
  }

  return (
    <>
      <GameBoard
        gameState={gameState}
        you={you}
        opp={opp}
        actions={actions}
        loading={loading}
        log={log}
        isMyTurn={isMyTurn}
        handleAction={handleAction}
        playTwoActions={playTwoActions}
        advanceAllMission={advanceAllMission}
        assignDamage={assignDamage}
        resolveSense={resolveSense}
        resolveCloud={resolveCloud}
        respondToPrompt={respondToPrompt}
        onMainMenu={onMainMenu}
        onForfeit={forfeit}
        isMultiplayer
      />
      {!isMyTurn && (gameState.phase as string) !== "game_over" && (
        <WaitingOverlay opponentName={opp.name} phase={gameState.phase} />
      )}
    </>
  );
}

// ── Shared Game Board ──

import type { LogEntry } from "./hooks/useGame";
import type { PlayerData, GameAction } from "./types/game";

function GameBoard({
  gameState,
  you,
  opp,
  actions,
  loading,
  log,
  isMyTurn,
  handleAction,
  playTwoActions,
  advanceAllMission,
  assignDamage,
  resolveSense,
  resolveCloud,
  respondToPrompt,
  onMainMenu,
  onForfeit,
  isMultiplayer,
  onUndo,
  canUndo,
}: {
  gameState: GameState;
  you: PlayerData;
  opp: PlayerData;
  actions: GameAction[];
  loading: boolean;
  log: LogEntry[];
  isMyTurn: boolean;
  handleAction: (index: number) => void;
  playTwoActions: (first: number, findSecond: (actions: GameAction[]) => number | undefined) => void;
  advanceAllMission: (name: string) => void;
  assignDamage: (targetIndex: number) => unknown;
  resolveSense: (use: boolean) => unknown;
  resolveCloud: (cardId: number) => unknown;
  respondToPrompt: (type: string, value: number) => unknown;
  onMainMenu: () => void;
  onForfeit?: () => void;
  isMultiplayer?: boolean;
  onUndo?: () => void;
  canUndo?: boolean;
}) {
  return (
    <div className="game-board">
      <div className="board-left">
        <div className="left-main">
          <div className="left-top-row">
            <div className="player-info-with-training">
              <PlayerInfo player={you} actions={actions} onAction={handleAction} onCompositeAction={(first, findSecond) => { if (!loading) playTwoActions(first, findSecond); }} discard={you.discard} marketDiscard={gameState.market.discard} />
              <TrainingTrack training={you.training} character={you.character} />
              <MetalTokens player={you} actions={actions} onAction={handleAction} />
            </div>
            <div className="market-and-allies">
              <Market market={gameState.market} actions={actions} onAction={handleAction} />
              <AllyZone
                allies={you.allies}
                actions={actions}
                player={you}
                onAction={handleAction}
                onCompositeAction={(first, findSecond) => { if (!loading) playTwoActions(first, findSecond); }}
                label="Your Allies"
              />
            </div>
          </div>
          <Hand
            cards={you.hand}
            actions={actions}
            player={you}
            onAction={handleAction}
            onCompositeAction={(first, findSecond) => { if (!loading) playTwoActions(first, findSecond); }}
            deckSize={you.deckSize}
            discardSize={you.discardSize}
          />
        </div>
      </div>
      <div className="board-right">
        <PlayerInfo player={opp} isOpponent />
        <AllyZone allies={opp.allies} actions={[]} onAction={() => {}} label="Opponent Allies" />
        <MissionTrack missions={gameState.missions} actions={actions} onAction={handleAction} onAdvanceAll={(name) => { if (!loading) advanceAllMission(name); }} missionPoints={you.mission} />
        <ActivityLog log={log} />
        <div className="right-footer">
          {gameState.phase === "damage" && isMyTurn ? (
            <DamagePhase
              damage={you.damage}
              targets={gameState.damageTargets ?? []}
              onAssign={(idx) => { if (!loading) assignDamage(idx); }}
            />
          ) : (
            <ActionList
              actions={actions}
              onAction={handleAction}
              missionRemaining={you.mission}
              player={you}
              onUndo={onUndo}
              canUndo={canUndo}
            />
          )}
          <div className="turn-info">
            <span>Turn {gameState.turnCount}</span>
            {isMultiplayer && <span>{isMyTurn ? " — Your Turn" : " — Opponent's Turn"}</span>}
            {loading && <span className="loading">...</span>}
          </div>
          {onForfeit && (
            <button className="forfeit-btn" onClick={onForfeit}>
              Forfeit
            </button>
          )}
          <button className="main-menu-btn" onClick={onMainMenu}>
            Main Menu
          </button>
        </div>
      </div>
      {gameState.prompt && isMyTurn && (
        <PromptDialog
          prompt={gameState.prompt}
          onRespond={(type, value) => respondToPrompt(type, value)}
        />
      )}
      {gameState.phase === "sense_defense" && gameState.senseCards && isMyTurn && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <h3>Sense Defense</h3>
            {gameState.senseCards.map(c => (
              <p key={c.cardId}>
                <strong>{c.name}</strong> — blocks <strong>{c.amount}</strong> mission per advance (can go negative)
              </p>
            ))}
            <p className="modal-note">If the opponent advances a mission, your card will be discarded to block it.</p>
            <div className="modal-actions">
              <button className="action-btn" style={{borderColor: "var(--blue-bright)"}}
                onClick={() => { if (!loading) resolveSense(true); }}>
                Use Sense
              </button>
              <button className="action-btn" style={{borderColor: "var(--text-dim)", opacity: 0.7}}
                onClick={() => { if (!loading) resolveSense(false); }}>
                Skip
              </button>
            </div>
          </div>
        </div>
      )}
      {gameState.phase === "cloud_defense" && gameState.cloudCards && isMyTurn && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <h3>Cloud Defense</h3>
            <p>Incoming: <strong>{gameState.incomingDamage ?? "?"}</strong> damage! Discard a cloud card to block?</p>
            <div className="modal-actions">
              {gameState.cloudCards.map(c => (
                <button key={c.cardId} className="action-btn" style={{borderColor: "var(--green)"}}
                  onClick={() => { if (!loading) resolveCloud(c.cardId); }}>
                  Use {c.name} (block {c.reduction})
                </button>
              ))}
              <button className="action-btn" style={{borderColor: "var(--text-dim)", opacity: 0.7}}
                onClick={() => { if (!loading) resolveCloud(-1); }}>
                Take the damage
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
