import { useEffect, useState } from "react";
import "./App.css";
import { useGame } from "./hooks/useGame";
import { useAuth } from "./hooks/useAuth";
import { useLobby } from "./hooks/useLobby";
import { useMultiplayerGame } from "./hooks/useMultiplayerGame";
import { GameSession } from "./engine/session";
import { db, id as instantId } from "./lib/instantdb";
import { CardGallery } from "./components/CardGallery";
import { Lobby } from "./components/Lobby";
import { MenuShell } from "./components/MenuShell";
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
import { CardFlashOverlay } from "./components/CardFlashOverlay";
import { TurnRecap } from "./components/TurnRecap";
import { TurnBanner } from "./components/TurnBanner";
import { PromptDialog } from "./components/PromptDialog";
import { DamagePhase } from "./components/DamagePhase";
import { GameOverScreen } from "./components/GameOverScreen";
import { CHARACTERS } from "./data/ministrySigils";
import type { BotSetupConfig } from "./hooks/useMinistryPrefs";
import type { GameState } from "./types/game";

type AppMode = "menu" | "gallery" | "bot_game" | "lobby" | "mp_game";

function pickRandomChar(): string {
  return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
}
function resolveChar(c: string, avoid?: string): string {
  if (c !== "Random" && c) return c;
  let pick = pickRandomChar();
  if (avoid) {
    let guard = 0;
    while (pick === avoid && guard++ < 16) pick = pickRandomChar();
  }
  return pick;
}

function App() {
  const [mode, setMode] = useState<AppMode>("menu");
  const [mpSessionId, setMpSessionId] = useState<string | null>(null);

  const botGame = useGame();
  const auth    = useAuth();
  const lobby   = useLobby(auth.user?.id, auth.profile?.name);
  const mpGame  = useMultiplayerGame(mpSessionId, auth.user?.id ?? null);

  // Transition menu → lobby when a room appears, and lobby → menu when it clears.
  useEffect(() => {
    if (mode === "menu" && lobby.room) setMode("lobby");
    else if (mode === "lobby" && !lobby.room) setMode("menu");
  }, [mode, lobby.room]);

  // Transition lobby → mp_game when the room's game starts.
  useEffect(() => {
    if (mode === "lobby" && lobby.room?.status === "in_game" && lobby.room.sessionId) {
      if (mpSessionId !== lobby.room.sessionId) {
        setMpSessionId(lobby.room.sessionId);
        setMode("mp_game");
      }
    }
  }, [mode, lobby.room?.status, lobby.room?.sessionId, mpSessionId]);

  const startBot = (cfg: BotSetupConfig, displayName: string) => {
    const myChar  = resolveChar(cfg.myChar);
    const oppChar = resolveChar(cfg.oppChar, myChar);
    botGame.createGame(displayName, myChar, cfg.botType, oppChar, !cfg.youFirst, false);
    setMode("bot_game");
  };

  const handleStartMatchFromLobby = async () => {
    if (!lobby.room || !auth.user) return;
    try {
      const choice = lobby.room.firstPlayer ?? "random";
      const firstPlayer: 0 | 1 =
        choice === "host" ? 0
        : choice === "guest" ? 1
        : Math.random() < 0.5 ? 0 : 1;

      const hostChar  = resolveChar(lobby.room.hostCharacter);
      const guestChar = resolveChar(lobby.room.guestCharacter);

      const session = new GameSession({
        players: [
          { kind: "human", name: lobby.room.hostName,  character: hostChar },
          { kind: "human", name: lobby.room.guestName, character: guestChar },
        ],
        firstPlayer,
      });

      const gameId = instantId();
      const payload = session.getInstantDBPayload();

      await db.transact(
        db.tx.games[gameId].update({
          roomId: lobby.room.id,
          ...payload,
          p0Id: lobby.room.hostId,
          p1Id: lobby.room.guestId,
          stateVersion: 0,
        })
      );
      await db.transact(
        db.tx.rooms[lobby.room.id].update({
          status: "in_game",
          sessionId: gameId,
        })
      );

      mpGame.sessionRef.current = session;
      setMpSessionId(gameId);
      setMode("mp_game");
    } catch (e) {
      console.error("Failed to start game:", e);
    }
  };

  // ── Gallery ──
  if (mode === "gallery") {
    return <CardGallery onBack={() => setMode("menu")} />;
  }

  // ── Bot game ──
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

  // ── Multiplayer game ──
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

  // ── In-room lobby (waiting / character select) ──
  if (mode === "lobby" && lobby.room) {
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
        onLeave={() => lobby.leaveRoom()}
        onStartGame={handleStartMatchFromLobby}
        onBack={() => setMode("menu")}
        onSetFirstPlayer={lobby.setFirstPlayer}
      />
    );
  }

  // ── Menu shell (default) ──
  return (
    <MenuShell
      isAuthed={!!auth.user}
      displayName={auth.profile?.name ?? auth.user?.email?.split("@")[0] ?? null}
      profileCreatedAt={auth.profile?.createdAt ?? null}
      authError={auth.error}
      sendMagicCode={async (email) => { await auth.sendMagicCode(email); }}
      verifyMagicCode={async (email, code) => { await auth.verifyMagicCode(email, code); }}
      ensureProfile={auth.ensureProfile}
      signOut={auth.signOut}
      onStartBot={startBot}
      onViewCards={() => setMode("gallery")}
      onViewMinistryLog={() => { /* not implemented yet */ }}
      onCreateRoom={lobby.createRoom}
      onJoinRoom={lobby.joinRoom}
      lobbyBusy={lobby.isLoading}
      lobbyError={lobby.error}
    />
  );
}

// ── Bot Game Board (existing behavior, extracted) ──

function BotGameBoard({
  game,
  onMainMenu,
}: {
  game: ReturnType<typeof useGame>;
  onMainMenu: () => void;
}) {
  const { gameState, loading, log, flashQueue, consumeFlash, recap, consumeRecap, banner, consumeBanner, playAction, advanceAllMission, playTwoActions, assignDamage, resolveSense, resolveCloud, respondToPrompt, undo, canUndo } = game;

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
      <GameOverScreen
        gameState={gameState}
        you={you}
        opp={opp}
        log={log}
        youWon={gameState.winner === you.name}
        backLabel="New Game"
        onBack={onMainMenu}
      />
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
      <CardFlashOverlay queue={flashQueue} onDone={consumeFlash} />
      <TurnRecap recap={recap} onDone={consumeRecap} waiting={flashQueue.length > 0} />
      <TurnBanner banner={banner} onDone={consumeBanner} />
    </>
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
  const { gameState, loading, log, flashQueue, consumeFlash, recap, consumeRecap, banner, consumeBanner, isMyTurn, myPlayerIndex, playAction, advanceAllMission, playTwoActions, assignDamage, resolveSense, resolveCloud, respondToPrompt, forfeit, undo, canUndo } = game;

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
      <GameOverScreen
        gameState={gameState}
        you={you}
        opp={opp}
        log={log}
        youWon={iWon}
        backLabel="Back to Lobby"
        onBack={onMainMenu}
      />
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
        onUndo={undo}
        canUndo={canUndo}
        isMultiplayer
      />
      {!isMyTurn && (gameState.phase as string) !== "game_over" && (
        <WaitingOverlay opponentName={opp.name} phase={gameState.phase} />
      )}
      <CardFlashOverlay queue={flashQueue} onDone={consumeFlash} />
      <TurnRecap recap={recap} onDone={consumeRecap} waiting={flashQueue.length > 0} />
      <TurnBanner banner={banner} onDone={consumeBanner} />
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
  playTwoActions: (first: number, secondMatch: { code: number; cardIds?: number[] }) => void;
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
              <PlayerInfo player={you} actions={actions} onAction={handleAction} onCompositeAction={(first, secondMatch) => { if (!loading) playTwoActions(first, secondMatch); }} discard={you.discard} marketDiscard={gameState.market.discard} />
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
                onCompositeAction={(first, secondMatch) => { if (!loading) playTwoActions(first, secondMatch); }}
                label="Your Allies"
              />
            </div>
          </div>
          <Hand
            cards={you.hand}
            actions={actions}
            player={you}
            onAction={handleAction}
            onCompositeAction={(first, secondMatch) => { if (!loading) playTwoActions(first, secondMatch); }}
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
              faceHitBlocked={gameState.faceHitBlocked ?? false}
              onAssign={(idx) => { if (!loading) assignDamage(idx); }}
            />
          ) : (
            <ActionList
              actions={actions}
              onAction={handleAction}
              missionRemaining={you.mission}
              player={you}
            />
          )}
          <div className="turn-info">
            <span>Turn {gameState.turnCount}</span>
            {isMultiplayer && <span>{isMyTurn ? " — Your Turn" : " — Opponent's Turn"}</span>}
            {loading && <span className="loading">...</span>}
          </div>
          {onUndo && (
            <button
              className={`undo-btn${canUndo ? "" : " disabled"}`}
              onClick={() => { if (canUndo) onUndo(); }}
              title={canUndo ? "Undo last action" : "Can't undo — new information has been revealed"}
              disabled={!canUndo}
            >
              ↶ Undo
            </button>
          )}
          <button className="main-menu-btn" onClick={() => {
            // In multiplayer, leaving an in-progress match = forfeit. The
            // Leave Match button doubles as the forfeit trigger (prior
            // separate Forfeit button removed for redundancy).
            if (isMultiplayer && onForfeit && gameState.phase !== "game_over") {
              onForfeit();
            }
            onMainMenu();
          }}>
            {isMultiplayer ? "Leave Match" : "Main Menu"}
          </button>
        </div>
      </div>
      {gameState.prompt && isMyTurn && (
        <PromptDialog
          prompt={gameState.prompt}
          gameState={gameState}
          onRespond={(type, value) => respondToPrompt(type, value)}
        />
      )}
      {gameState.phase === "sense_defense" && gameState.senseCards && isMyTurn && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <h3>Sense Defense</h3>
            <p className="modal-note">
              {gameState.senseMissionName
                ? <>Opponent is advancing <strong>{gameState.senseMissionName}</strong>. Block it with a Sense card?</>
                : <>Opponent is advancing a mission. Block it with a Sense card?</>}
            </p>
            {gameState.senseCards.map(c => (
              <p key={c.cardId}>
                <strong>{c.name}</strong> — blocks <strong>{c.amount}</strong> mission
              </p>
            ))}
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
