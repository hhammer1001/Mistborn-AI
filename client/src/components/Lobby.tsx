import { useState } from "react";
import type { Room } from "../hooks/useLobby";

const CHARACTERS = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];

interface LobbyProps {
  room: Room | null;
  myRole: "host" | "guest" | null;
  error: string | null;
  isLoading: boolean;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onSelectCharacter: (character: string) => void;
  onReady: (ready: boolean) => void;
  onLeave: () => void;
  onStartGame: () => void;
  onBack: () => void;
}

export function Lobby({
  room,
  myRole,
  error,
  isLoading,
  onCreateRoom,
  onJoinRoom,
  onSelectCharacter,
  onReady,
  onLeave,
  onStartGame,
  onBack,
}: LobbyProps) {
  // No room yet — show create/join
  if (!room) {
    return (
      <LobbyHome
        error={error}
        onCreateRoom={onCreateRoom}
        onJoinRoom={onJoinRoom}
        onBack={onBack}
      />
    );
  }

  // Waiting for opponent
  if (room.status === "waiting") {
    return (
      <WaitingForOpponent
        roomCode={room.code}
        onLeave={onLeave}
      />
    );
  }

  // Character select
  if (room.status === "character_select") {
    return (
      <CharacterSelect
        room={room}
        myRole={myRole!}
        onSelectCharacter={onSelectCharacter}
        onReady={onReady}
        onStartGame={onStartGame}
        onLeave={onLeave}
        isLoading={isLoading}
      />
    );
  }

  // In game or finished — shouldn't render lobby
  return null;
}

function LobbyHome({
  error,
  onCreateRoom,
  onJoinRoom,
  onBack,
}: {
  error: string | null;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onBack: () => void;
}) {
  const [joinCode, setJoinCode] = useState("");
  const [mode, setMode] = useState<"menu" | "join">("menu");

  return (
    <div className="game-setup">
      <h1>Play Online</h1>
      {error && <p className="lobby-error">{error}</p>}

      {mode === "menu" ? (
        <div className="setup-form">
          <button onClick={onCreateRoom}>Create Room</button>
          <button onClick={() => setMode("join")}>Join Room</button>
          <button className="view-cards-btn" onClick={onBack}>
            Main Menu
          </button>
        </div>
      ) : (
        <div className="setup-form">
          <label>
            Room Code
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABCD"
              maxLength={4}
              autoFocus
            />
          </label>
          <button
            onClick={() => onJoinRoom(joinCode)}
            disabled={joinCode.length < 4}
          >
            Join
          </button>
          <button className="view-cards-btn" onClick={() => setMode("menu")}>
            Back
          </button>
        </div>
      )}
    </div>
  );
}

function WaitingForOpponent({
  roomCode,
  onLeave,
}: {
  roomCode: string;
  onLeave: () => void;
}) {
  return (
    <div className="game-setup">
      <h1>Waiting for Opponent</h1>
      <div className="setup-form">
        <div className="room-code-display">
          <p>Share this code:</p>
          <span className="room-code">{roomCode}</span>
        </div>
        <p className="waiting-text">Waiting for someone to join...</p>
        <button className="view-cards-btn" onClick={onLeave}>
          Leave Lobby
        </button>
      </div>
    </div>
  );
}

function CharacterSelect({
  room,
  myRole,
  onSelectCharacter,
  onReady: _onReady,
  onStartGame,
  onLeave,
  isLoading,
}: {
  room: Room;
  myRole: "host" | "guest";
  onSelectCharacter: (character: string) => void;
  onReady: (ready: boolean) => void;
  onStartGame: () => void;
  onLeave: () => void;
  isLoading: boolean;
}) {
  const myCharacter = myRole === "host" ? room.hostCharacter : room.guestCharacter;
  const oppName = myRole === "host" ? room.guestName : room.hostName;
  const oppCharacter = myRole === "host" ? room.guestCharacter : room.hostCharacter;
  const bothChosen = !!(room.hostCharacter && room.guestCharacter);

  // Don't allow same character
  const oppSelected = myRole === "host" ? room.guestCharacter : room.hostCharacter;
  const availableCharacters = CHARACTERS.filter((c) => c !== oppSelected);

  return (
    <div className="game-setup">
      <h1>Character Select</h1>
      <div className="setup-form">
        <p className="lobby-opponent">
          vs <strong>{oppName}</strong>
          {oppCharacter ? ` (${oppCharacter})` : " — choosing..."}
        </p>

        <label>
          Your Character
          <select
            value={myCharacter || ""}
            onChange={(e) => onSelectCharacter(e.target.value)}
          >
            <option value="" disabled>
              Choose...
            </option>
            {availableCharacters.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        {bothChosen && myRole === "host" && (
          <button onClick={onStartGame} disabled={isLoading}>
            {isLoading ? "Starting..." : "Start Game"}
          </button>
        )}
        {bothChosen && myRole === "guest" && (
          <p className="waiting-text">Waiting for host to start...</p>
        )}
        {!bothChosen && myCharacter && (
          <p className="waiting-text">Waiting for opponent to pick...</p>
        )}

        <button className="view-cards-btn" onClick={onLeave}>
          Leave Lobby
        </button>
      </div>
    </div>
  );
}
