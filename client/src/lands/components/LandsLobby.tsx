import { useState } from "react";
import type {
  LandsRoom,
  LandsFirstPlayerChoice,
} from "../hooks/useLandsLobby";
import "./lands.css";

interface Props {
  room: LandsRoom | null;
  myRole: "host" | "guest" | null;
  error: string | null;
  isLoading: boolean;
  isAuthed: boolean;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onSetFirstPlayer: (choice: LandsFirstPlayerChoice) => void;
  onLeave: () => void;
  onStart: () => void;
  onBack: () => void;
  onOpenAuth: () => void;
}

export function LandsLobby({
  room,
  myRole,
  error,
  isLoading,
  isAuthed,
  onCreateRoom,
  onJoinRoom,
  onSetFirstPlayer,
  onLeave,
  onStart,
  onBack,
  onOpenAuth,
}: Props) {
  return (
    <div className="lands-root">
      <div className="lands-start-panel">
        <div className="lands-titleblock">
          <span className="lands-eyebrow">An Almanac for Two</span>
          <h1 className="lands-title">Two Players</h1>
          <div className="lands-title-rule" aria-hidden>❦</div>
          <p className="lands-subtitle">
            {!isAuthed
              ? "Sign in to create or join a room."
              : !room
                ? "Create a new room, or join one with a four-letter code."
                : room.status === "waiting"
                  ? "Waiting for someone to join…"
                  : "Ready check."}
          </p>
        </div>

        {error && <p className="lands-hint lands-lobby-error">{error}</p>}

        {!isAuthed ? (
          <SignInGate onOpenAuth={onOpenAuth} />
        ) : !room ? (
          <LobbyEntry onCreateRoom={onCreateRoom} onJoinRoom={onJoinRoom} />
        ) : room.status === "waiting" ? (
          <Waiting room={room} onLeave={onLeave} />
        ) : (
          <ReadyCheck
            room={room}
            myRole={myRole!}
            isLoading={isLoading}
            onSetFirstPlayer={onSetFirstPlayer}
            onLeave={onLeave}
            onStart={onStart}
          />
        )}

        <div className="lands-start-actions lands-lobby-back">
          <button className="lands-secondary" onClick={onBack}>
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-views ──────────────────────────────────────────────────────────────

function SignInGate({ onOpenAuth }: { onOpenAuth: () => void }) {
  return (
    <div className="lands-start-actions">
      <button onClick={onOpenAuth}>Open a File (Login)</button>
    </div>
  );
}

function LobbyEntry({
  onCreateRoom,
  onJoinRoom,
}: {
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"home" | "join">("home");
  if (mode === "home") {
    return (
      <div className="lands-start-actions">
        <button onClick={onCreateRoom}>Create Room</button>
        <button className="lands-secondary" onClick={() => setMode("join")}>
          Join Room
        </button>
      </div>
    );
  }
  return (
    <div className="lands-lobby-join">
      <label className="lands-lobby-code-label">
        <span>Room Code</span>
        <input
          className="lands-lobby-code-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCD"
          maxLength={4}
          autoFocus
        />
      </label>
      <div className="lands-start-actions">
        <button
          disabled={code.length < 4}
          onClick={() => onJoinRoom(code)}
        >
          Join
        </button>
        <button className="lands-secondary" onClick={() => setMode("home")}>
          Back
        </button>
      </div>
    </div>
  );
}

function Waiting({
  room,
  onLeave,
}: {
  room: LandsRoom;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — no-op.
    }
  };
  return (
    <div className="lands-lobby-waiting">
      <p className="lands-hint">Share this code:</p>
      <div className="lands-lobby-code-display">
        <span className="lands-lobby-code-text">{room.code}</span>
        <button className="lands-secondary" onClick={handleCopy}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="lands-start-actions">
        <button className="lands-secondary" onClick={onLeave}>
          Leave Room
        </button>
      </div>
    </div>
  );
}

function ReadyCheck({
  room,
  myRole,
  isLoading,
  onSetFirstPlayer,
  onLeave,
  onStart,
}: {
  room: LandsRoom;
  myRole: "host" | "guest";
  isLoading: boolean;
  onSetFirstPlayer: (choice: LandsFirstPlayerChoice) => void;
  onLeave: () => void;
  onStart: () => void;
}) {
  const oppName = myRole === "host" ? room.guestName : room.hostName;
  const firstChoice: LandsFirstPlayerChoice = room.firstPlayer ?? "random";
  return (
    <div className="lands-lobby-readycheck">
      <p className="lands-hint">
        vs <strong>{oppName}</strong>
      </p>

      {myRole === "host" && (
        <label className="lands-lobby-field">
          <span>Who goes first</span>
          <select
            value={firstChoice}
            onChange={(e) =>
              onSetFirstPlayer(e.target.value as LandsFirstPlayerChoice)
            }
          >
            <option value="random">Random</option>
            <option value="host">{room.hostName || "Host"}</option>
            <option value="guest">{room.guestName || "Guest"}</option>
          </select>
        </label>
      )}

      <div className="lands-start-actions">
        {myRole === "host" ? (
          <button onClick={onStart} disabled={isLoading}>
            {isLoading ? "Starting…" : "Start Match"}
          </button>
        ) : (
          <span className="lands-hint">Waiting for host to start…</span>
        )}
        <button className="lands-secondary" onClick={onLeave}>
          Leave Room
        </button>
      </div>
    </div>
  );
}
