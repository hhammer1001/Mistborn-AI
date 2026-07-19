import { useEffect, useState } from "react";
import "./App.css";
import "./mobile.css";
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
import { PastMatchView, type ReplayParams } from "./components/PastMatchView";
import { RankingPanel } from "./components/RankingPanel";
import { LandsGame, Board as LandsBoard, type BoardGameApi as LandsBoardApi } from "./lands/components/LandsGame";
import { LandsLobby } from "./lands/components/LandsLobby";
import { useLandsLobby } from "./lands/hooks/useLandsLobby";
import { useLandsMultiplayerGame } from "./lands/hooks/useLandsMultiplayerGame";
import { LandsSession } from "./lands/engine/session";
import type { LandsBotKind } from "./lands/hooks/useLandsGame";
import { BOT_TYPES, CHARACTERS } from "./data/ministrySigils";
import type { BotSetupConfig } from "./hooks/useMinistryPrefs";
import type { GameState } from "./types/game";
import { randomSeed } from "./engine/rng";

type AppMode =
  | "menu"
  | "gallery"
  | "bot_game"
  | "lobby"
  | "mp_game"
  | "past_match"
  | "lands"
  | "lands_lobby"
  | "lands_mp_game";

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
  const [pastMatchId, setPastMatchId] = useState<string | null>(null);
  /** When set, LandsGame skips its start screen and runs the configured match
   *  immediately. Used by the easter-egg "Play vs The Box / Cartographer" flow. */
  const [landsAutoStart, setLandsAutoStart] = useState<
    { humanFirst: boolean; botKind: LandsBotKind } | null
  >(null);
  /** Lands multiplayer session id — set when a match is created and the room
   *  transitions to "in_game". */
  const [landsMpSessionId, setLandsMpSessionId] = useState<string | null>(null);

  const botGame = useGame();
  const auth    = useAuth();
  const lobby   = useLobby(auth.user?.id, auth.profile?.name);
  const mpGame  = useMultiplayerGame(mpSessionId, auth.user?.id ?? null);
  const landsLobby = useLandsLobby(auth.user?.id, auth.profile?.name);
  const landsMpGame = useLandsMultiplayerGame(landsMpSessionId, auth.user?.id ?? null);

  // Waiting rooms live inside the menu shell (OnlineSetupView shows the code).
  // Only promote to the dedicated Lobby view once a guest joins and we hit character select.
  useEffect(() => {
    if (mode === "menu" && lobby.room?.status === "character_select") setMode("lobby");
    else if (mode === "lobby" && (!lobby.room || lobby.room.status === "waiting")) setMode("menu");
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

  // Lands lobby transitions:
  //   - Room dissolves (host left) → bounce back to menu.
  //   - Status becomes "in_game" → promote to lands_mp_game with the session id.
  useEffect(() => {
    if (mode !== "lands_lobby") return;
    if (!landsLobby.room) return; // room not yet created — stay in lobby entry
    if (landsLobby.room.status === "in_game" && landsLobby.room.sessionId) {
      if (landsMpSessionId !== landsLobby.room.sessionId) {
        setLandsMpSessionId(landsLobby.room.sessionId);
        setMode("lands_mp_game");
      }
    }
  }, [mode, landsLobby.room?.status, landsLobby.room?.sessionId, landsMpSessionId, landsLobby.room]);

  /** Host clicks "Start Match" in the Lands lobby: build a LandsSession,
   *  write the initial payload + ids to landsGames, mark the room in_game.
   *  Guests just observe the transition. */
  const handleStartLandsMatch = async () => {
    const room = landsLobby.room;
    if (!room || !auth.user || landsLobby.myRole !== "host") return;
    try {
      const choice = room.firstPlayer ?? "random";
      const firstPlayer: 0 | 1 =
        choice === "host" ? 0
        : choice === "guest" ? 1
        : Math.random() < 0.5 ? 0 : 1;

      const session = new LandsSession({
        playerNames: [room.hostName, room.guestName],
        firstPlayer,
        // MP: always open the counter window when the opponent has ≥2 cards
        // so the active player can't free-read whether a counter is held.
        bluffMode: true,
      });

      // CRITICAL: pin the session into the hook BEFORE any DB writes. The
      // room-status update below triggers the lobby's auto-transition
      // useEffect, which switches mode to lands_mp_game. The MP hook's
      // session-subscribe useEffect then runs — if sessionRef.current isn't
      // set yet, it skips silently and the host never gets a listener
      // installed (UI stays frozen on initial state, clicks appear no-op).
      landsMpGame.sessionRef.current = session;

      const gameId = instantId();
      const payload = session.getDbPayload(0);
      await db.transact(
        db.tx.landsGames[gameId].update({
          ...payload,
          roomId: room.id,
          p0Id: room.hostId,
          p1Id: room.guestId,
          pendingAction: null,
        }),
      );
      await db.transact(
        db.tx.landsRooms[room.id].update({
          status: "in_game",
          sessionId: gameId,
        }),
      );

      // sessionRef was pinned earlier (before the DB writes) — see comment
      // above. Here we just complete the transition.
      setLandsMpSessionId(gameId);
      setMode("lands_mp_game");
    } catch (e) {
      console.error("Failed to start Lands match:", e);
    }
  };

  const startBot = (cfg: BotSetupConfig, displayName: string, seed?: number) => {
    const myChar  = resolveChar(cfg.myChar);
    const oppChar = resolveChar(cfg.oppChar, myChar);
    const humanIdentity = {
      profileId: auth.profile?.id ?? "",
      userId:    auth.user?.id ?? "",
      name:      displayName,
    };
    const botFirst =
      cfg.firstPlayer === "bot" ? true :
      cfg.firstPlayer === "you" ? false :
      Math.random() < 0.5;  // "random"
    botGame.createGame(displayName, myChar, cfg.botType, oppChar, botFirst, cfg.testDeck, humanIdentity, seed);
    setMode("bot_game");
  };

  const handleReplayMatch = (params: ReplayParams) => {
    const displayName = auth.profile?.name ?? auth.user?.email?.split("@")[0] ?? "Guest";
    // The original opponent may have been a human (PvP) — replay always uses
    // a bot. Default to the original bot strategy when present; fall back to
    // "twonky" so the replay still runs.
    const botType = (BOT_TYPES as readonly string[]).includes(params.botStrategy)
      ? (params.botStrategy as (typeof BOT_TYPES)[number])
      : "twonky";
    startBot(
      {
        myChar: params.myCharacter,
        oppChar: params.oppCharacter,
        botType,
        firstPlayer: params.meFirst ? "you" : "bot",
        testDeck: false,
      },
      displayName,
      params.seed,
    );
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
          matchSetup: {
            players: [
              { name: lobby.room.hostName, character: hostChar },
              { name: lobby.room.guestName, character: guestChar },
            ],
            firstPlayer,
            seed: session.game.seed,
          },
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

      setMpSessionId(gameId);
      setMode("mp_game");
    } catch (e) {
      console.error("Failed to start game:", e);
    }
  };

  const handlePlayOppositeMultiplayer = async (
    players: [PlayerData, PlayerData],
    firstPlayer: 0 | 1,
  ) => {
    const room = lobby.room;
    if (!room) return;
    try {
      const swappedFirstPlayer: 0 | 1 = firstPlayer === 0 ? 1 : 0;
      const session = new GameSession({
        players: [
          { kind: "human", name: players[1].name, character: players[1].character },
          { kind: "human", name: players[0].name, character: players[0].character },
        ],
        firstPlayer: swappedFirstPlayer,
        seed: randomSeed(),
      });
      const gameId = instantId();
      await db.transact(
        db.tx.games[gameId].update({
          roomId: room.id,
          ...session.getInstantDBPayload(),
          matchSetup: {
            players: [
              { name: players[1].name, character: players[1].character },
              { name: players[0].name, character: players[0].character },
            ],
            firstPlayer: swappedFirstPlayer,
            seed: session.game.seed,
          },
          p0Id: room.guestId,
          p1Id: room.hostId,
          stateVersion: 0,
          pendingAction: null,
        }),
      );
      await db.transact(db.tx.rooms[room.id].update({ status: "in_game", sessionId: gameId }));
      setMpSessionId(gameId);
    } catch (e) {
      console.error("Failed to start opposite-side rematch:", e);
    }
  };

  // ── Gallery ──
  if (mode === "gallery") {
    return <CardGallery onBack={() => setMode("menu")} />;
  }

  // ── Lands lobby (PvP setup) ──
  if (mode === "lands_lobby") {
    return (
      <LandsLobby
        room={landsLobby.room}
        myRole={landsLobby.myRole}
        error={landsLobby.error}
        isLoading={landsLobby.isLoading}
        isAuthed={!!auth.user}
        onCreateRoom={landsLobby.createRoom}
        onJoinRoom={landsLobby.joinRoom}
        onSetFirstPlayer={landsLobby.setFirstPlayer}
        onLeave={() => landsLobby.leaveRoom()}
        onStart={handleStartLandsMatch}
        onBack={() => {
          void landsLobby.leaveRoom();
          setMode("menu");
        }}
        onOpenAuth={() => {
          // Punt to the menu, where the existing auth modal lives.
          setMode("menu");
        }}
      />
    );
  }

  // ── Lands multiplayer game ──
  if (mode === "lands_mp_game") {
    const exitToMenu = () => {
      setLandsMpSessionId(null);
      // Leaving the in-progress room — clean up.
      void landsLobby.leaveRoom();
      setMode("menu");
    };
    if (!landsMpGame.state || landsMpGame.myPlayerIndex === null) {
      return (
        <div className="lands-root">
          <div className="lands-empty-msg" style={{ margin: "auto" }}>
            Connecting…
          </div>
        </div>
      );
    }
    const api: LandsBoardApi = {
      state: landsMpGame.state,
      humanSeat: landsMpGame.myPlayerIndex,
      playCard: landsMpGame.playCard,
      passMain: landsMpGame.passMain,
      declineCounter: landsMpGame.declineCounter,
      counter: landsMpGame.counter,
      resolveMountain: landsMpGame.resolveMountain,
      resolveSwamp: landsMpGame.resolveSwamp,
      resolveForest: landsMpGame.resolveForest,
      resolveIsland: landsMpGame.resolveIsland,
      setBluffMode: landsMpGame.setBluffMode,
    };
    return <LandsBoard game={api} onExit={exitToMenu} />;
  }

  // ── Lands (side project) ──
  if (mode === "lands") {
    const playerName =
      auth.profile?.name ?? auth.user?.email?.split("@")[0] ?? "Player";
    const humanIdentity = {
      profileId: auth.profile?.id ?? "",
      userId: auth.user?.id ?? "",
      name: playerName,
    };
    return (
      <LandsGame
        onExit={() => {
          setLandsAutoStart(null);
          setMode("menu");
        }}
        playerName={playerName}
        humanIdentity={humanIdentity}
        autoStart={
          landsAutoStart
            ? {
                humanFirst: landsAutoStart.humanFirst,
                botKind: landsAutoStart.botKind,
                opponentName:
                  landsAutoStart.botKind === "planner"
                    ? "The Strategist"
                    : landsAutoStart.botKind === "flowchart"
                      ? "The Cartographer"
                      : landsAutoStart.botKind === "heuristic"
                        ? "The Heuristic"
                        : "The Box",
              }
            : undefined
        }
      />
    );
  }

  // ── Bot game ──
  if (mode === "bot_game") {
    return (
      <BotGameBoard
        game={botGame}
        onPlayOpposite={() => {
          const replay = botGame.getOppositeSideReplay();
          if (!replay) return;
          const displayName = auth.profile?.name ?? auth.user?.email?.split("@")[0] ?? "Guest";
          startBot({
            myChar: replay.humanCharacter,
            oppChar: replay.botCharacter,
            botType: replay.botType as BotSetupConfig["botType"],
            firstPlayer: replay.botFirst ? "bot" : "you",
            testDeck: false,
          }, displayName, replay.seed);
        }}
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
        onPlayOpposite={handlePlayOppositeMultiplayer}
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

  if (mode === "past_match" && pastMatchId) {
    return (
      <PastMatchView
        matchId={pastMatchId}
        userId={auth.user?.id ?? null}
        onBack={() => { setPastMatchId(null); setMode("menu"); }}
        onReplay={(params) => { setPastMatchId(null); handleReplayMatch(params); }}
      />
    );
  }

  // ── Menu shell (default) ──
  return (
    <MenuShell
      isAuthed={!!auth.user}
      userId={auth.user?.id ?? null}
      displayName={auth.profile?.name ?? auth.user?.email?.split("@")[0] ?? null}
      profileCreatedAt={auth.profile?.createdAt ?? null}
      authError={auth.error}
      sendMagicCode={async (email) => { await auth.sendMagicCode(email); }}
      verifyMagicCode={async (email, code) => { await auth.verifyMagicCode(email, code); }}
      ensureProfile={auth.ensureProfile}
      signOut={auth.signOut}
      onStartBot={startBot}
      onViewCards={() => setMode("gallery")}
      onSelectMatch={(id) => { setPastMatchId(id); setMode("past_match"); }}
      onViewLands={() => {
        setLandsAutoStart(null);
        setMode("lands");
      }}
      onStartLandsBot={(fp, botKind) => {
        const humanFirst =
          fp === "you" ? true :
          fp === "bot" ? false :
          Math.random() < 0.5;
        setLandsAutoStart({ humanFirst, botKind });
        setMode("lands");
      }}
      onPickLandsOnline={() => setMode("lands_lobby")}
      room={lobby.room}
      onCreateRoom={lobby.createRoom}
      onJoinRoom={lobby.joinRoom}
      onLeaveRoom={lobby.leaveRoom}
      lobbyError={lobby.error}
    />
  );
}

// ── Bot Game Board (existing behavior, extracted) ──

function BotGameBoard({
  game,
  onMainMenu,
  onPlayOpposite,
}: {
  game: ReturnType<typeof useGame>;
  onMainMenu: () => void;
  onPlayOpposite: () => void;
}) {
  const { gameState, loading, log, flashQueue, consumeFlash, recap, consumeRecap, banner, consumeBanner, playAction, advanceAllMission, playTwoActions, assignDamage, resolveSense, resolveCloud, resolveAllyDefense, respondToPrompt, undo, canUndo, forfeit } = game;

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
        onReplayOpposite={onPlayOpposite}
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
        resolveAllyDefense={resolveAllyDefense}
        respondToPrompt={respondToPrompt}
        onMainMenu={onMainMenu}
        onForfeit={forfeit}
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
  onPlayOpposite,
}: {
  game: ReturnType<typeof useMultiplayerGame>;
  onMainMenu: () => void;
  onPlayOpposite: (players: [PlayerData, PlayerData], firstPlayer: 0 | 1) => void;
}) {
  const { gameState, loading, log, flashQueue, consumeFlash, recap, consumeRecap, banner, consumeBanner, isMyTurn, myPlayerIndex, playAction, advanceAllMission, playTwoActions, assignDamage, resolveSense, resolveCloud, resolveAllyDefense, respondToPrompt, forfeit, undo, canUndo } = game;

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
        onReplayOpposite={() => {
          const firstPlayer = game.matchSetup?.firstPlayer ?? 0;
          onPlayOpposite([gameState.players[0], gameState.players[1]], firstPlayer);
        }}
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
        resolveAllyDefense={resolveAllyDefense}
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
  resolveAllyDefense,
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
  resolveSense: (cardIds: number[]) => unknown;
  resolveCloud: (cardIds: number[]) => unknown;
  resolveAllyDefense: (cardId: number) => unknown;
  respondToPrompt: (type: string, value: number) => unknown;
  onMainMenu: () => void;
  onForfeit?: () => void | Promise<void>;
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
          <button className="main-menu-btn" onClick={async () => {
            // Leaving an in-progress match = forfeit. Await so the match-log
            // write lands before the component unmounts.
            if (onForfeit && gameState.phase !== "game_over") {
              await onForfeit();
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
          <RankingPanel
            variant="sense"
            mode="toggle"
            cards={gameState.senseCards.map((c) => ({
              id: c.cardId,
              name: c.name,
              blockValue: c.amount,
            }))}
            caption={
              gameState.senseMissionName
                ? `Opponent is advancing ${gameState.senseMissionName}.`
                : "Opponent is advancing a mission."
            }
            formatStatus={(selected) => {
              // Pool size = the attacker's remaining mission resource; each
              // advance costs 1, and a chosen sense card consumes block-value
              // mission instead (see player.ts:861). Selecting cards in this
              // modal pre-commits blocks for subsequent advances this turn.
              const pool = opp.mission;
              const sumSelected = selected.reduce((s, c) => s + c.blockValue, 0);
              const left = Math.max(0, pool - sumSelected);
              return (
                <>
                  <strong>{pool}</strong> mission currently in pool,{" "}
                  <strong>{left}</strong> mission left after sensing
                </>
              );
            }}
            onSubmit={(ids) => {
              if (loading) return;
              // First id blocks the current advance; any others are queued to
              // auto-block the bot's subsequent advances this turn without
              // re-prompting. Empty = let this advance through.
              resolveSense(ids);
            }}
          />
        </div>
      )}
      {gameState.phase === "cloud_defense" && gameState.cloudCards && isMyTurn && (
        <div className="modal-overlay">
          <RankingPanel
            variant="cloud"
            mode="toggle"
            cards={gameState.cloudCards.map((c) => ({
              id: c.cardId,
              name: c.name,
              blockValue: c.reduction,
            }))}
            caption="Opponent is hitting you."
            formatStatus={(selected) => {
              const incoming = gameState.incomingDamage ?? 0;
              const blocked = selected.reduce((s, c) => s + c.blockValue, 0);
              const taken = Math.max(0, incoming - blocked);
              return (
                <>
                  <strong>{incoming}</strong> damage currently in pool,{" "}
                  <strong>{taken}</strong> damage left after smoking
                </>
              );
            }}
            onSubmit={(ids) => {
              if (loading) return;
              // Engine applies all selected clouds in one resolve and exits the
              // phase. Empty array = take the damage.
              resolveCloud(ids);
            }}
          />
        </div>
      )}
      {gameState.phase === "ally_defense" && gameState.cloudAllyCards && gameState.targetedAlly && isMyTurn && (
        <div className="modal-overlay">
          <RankingPanel
            variant="ally"
            mode="select"
            cards={gameState.cloudAllyCards.map((c) => ({
              id: c.cardId,
              name: c.name,
              blockValue: 1,
            }))}
            caption={`Opponent is killing your ${gameState.targetedAlly.name} (${gameState.targetedAlly.health} HP). Tap a card to discard it and save the ally, or let it die.`}
            actionLabel={`Save ${gameState.targetedAlly.name}`}
            skipLabel={`Let ${gameState.targetedAlly.name} die`}
            onSelect={(cardId) => {
              if (loading) return;
              resolveAllyDefense(cardId ?? -1);
            }}
          />
        </div>
      )}
    </div>
  );
}

export default App;
