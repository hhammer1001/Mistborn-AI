import { useMemo, useState } from "react";
import { db } from "../lib/instantdb";
import { GameOverScreen } from "./GameOverScreen";
import {
  reconstructPostgame,
  hasFullSnapshot,
  type MatchRow,
  type PlayerRow,
} from "../lib/reconstructPostgame";

interface Props {
  matchId: string;
  userId: string | null;
  onBack: () => void;
  /** Start a new bot game with the saved seed + characters. The user picks
   *  which seat to play; the other seat is filled by a bot defaulting to the
   *  original match's strategy. */
  onReplay: (params: ReplayParams) => void;
}

export interface ReplayParams {
  seed: number;
  /** Which seat the user wants to play (0 or 1). */
  seatIndex: 0 | 1;
  /** Character for the user's seat. */
  myCharacter: string;
  /** Character for the opponent seat. */
  oppCharacter: string;
  /** Whether the user goes first this game. Mirrors the original match's
   *  firstPlayerIndex relative to the chosen seat. */
  meFirst: boolean;
  /** Original bot strategy (if known) so the replay can default to it. Empty
   *  string for PvP matches. */
  botStrategy: string;
}

export function PastMatchView({ matchId, userId, onBack, onReplay }: Props) {
  const matchQ = db.useQuery({
    matches: { $: { where: { id: matchId } } },
    matchPlayers: { $: { where: { matchId } } },
  });

  const match = matchQ.data?.matches?.[0] as MatchRow | undefined;
  const players = (matchQ.data?.matchPlayers ?? []) as PlayerRow[];

  // Default perspective: whichever seat the current user occupied. Fall back
  // to seat 0 for PvB-from-the-opposite-side cases or anonymous viewing.
  const defaultPerspective = useMemo<0 | 1>(() => {
    if (!userId) return 0;
    const mine = players.find((p) => p.userId === userId);
    return (mine?.playerIndex ?? 0) as 0 | 1;
  }, [players, userId]);

  const [perspective, setPerspective] = useState<0 | 1 | null>(null);
  const effectivePerspective = perspective ?? defaultPerspective;
  const [replayPickerOpen, setReplayPickerOpen] = useState(false);

  if (matchQ.isLoading) {
    return <CenteredMessage text="Loading match…" onBack={onBack} />;
  }
  if (!match || players.length < 2) {
    return <CenteredMessage text="Match not found." onBack={onBack} />;
  }

  // Legacy match (pre-snapshot) — show a summary-only fallback rather than
  // attempting to render the GameOver screen with empty card lists.
  if (!hasFullSnapshot(match, players)) {
    return <LegacyMatchSummary match={match} players={players} userId={userId} onBack={onBack} />;
  }

  const reconstructed = reconstructPostgame(match, players, effectivePerspective);
  if (!reconstructed) {
    return <CenteredMessage text="Couldn't rebuild this match." onBack={onBack} />;
  }

  const { gameState, you, opp, log, youWon } = reconstructed;
  const otherPerspective: 0 | 1 = effectivePerspective === 0 ? 1 : 0;
  const otherPlayer = players.find((p) => p.playerIndex === otherPerspective);

  const handleReplay = (seatIndex: 0 | 1) => {
    if (typeof match.seed !== "number") return;
    const p0 = players.find((p) => p.playerIndex === 0)!;
    const p1 = players.find((p) => p.playerIndex === 1)!;
    const myChar = seatIndex === 0 ? p0.character : p1.character;
    const oppChar = seatIndex === 0 ? p1.character : p0.character;
    const firstPlayerIndex = (match.firstPlayerIndex ?? 0) as 0 | 1;
    onReplay({
      seed: match.seed,
      seatIndex,
      myCharacter: myChar,
      oppCharacter: oppChar,
      meFirst: firstPlayerIndex === seatIndex,
      botStrategy: match.botStrategy ?? "",
    });
  };

  return (
    <>
      <div className="pm-controls">
        {otherPlayer && (
          <button
            className="gg-btn gg-btn-ghost"
            onClick={() => setPerspective(otherPerspective)}
            title="Switch perspective"
          >
            View as {otherPlayer.name}
          </button>
        )}
        {typeof match.seed === "number" && (
          <button
            className="gg-btn gg-btn-primary"
            onClick={() => setReplayPickerOpen(true)}
          >
            Replay with same seed
          </button>
        )}
      </div>
      <GameOverScreen
        gameState={gameState}
        you={you}
        opp={opp}
        log={log}
        youWon={youWon}
        backLabel="Back to Ministry"
        onBack={onBack}
      />
      {replayPickerOpen && (
        <ReplaySeatPicker
          match={match}
          players={players}
          onCancel={() => setReplayPickerOpen(false)}
          onPick={(seat) => {
            setReplayPickerOpen(false);
            handleReplay(seat);
          }}
        />
      )}
    </>
  );
}

function ReplaySeatPicker({
  match,
  players,
  onCancel,
  onPick,
}: {
  match: MatchRow;
  players: PlayerRow[];
  onCancel: () => void;
  onPick: (seat: 0 | 1) => void;
}) {
  const p0 = players.find((p) => p.playerIndex === 0);
  const p1 = players.find((p) => p.playerIndex === 1);
  const firstPlayerIndex = (match.firstPlayerIndex ?? 0) as 0 | 1;
  const seatLabel = (p: PlayerRow | undefined): string => {
    if (!p) return "—";
    const first = p.playerIndex === firstPlayerIndex ? " (went first)" : "";
    return `${p.name} — ${p.character}${first}`;
  };
  return (
    <div className="pm-overlay" onClick={onCancel}>
      <div className="pm-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Replay with same seed</h3>
        <p>Pick the seat you want to play. The other seat will be filled by a bot.</p>
        <div className="pm-seat-row">
          <button className="gg-btn gg-btn-primary" onClick={() => onPick(0)}>{seatLabel(p0)}</button>
          <button className="gg-btn gg-btn-primary" onClick={() => onPick(1)}>{seatLabel(p1)}</button>
        </div>
        <button className="gg-btn gg-btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function CenteredMessage({ text, onBack }: { text: string; onBack: () => void }) {
  return (
    <div className="pm-centered">
      <p>{text}</p>
      <button className="gg-btn gg-btn-ghost" onClick={onBack}>Back</button>
    </div>
  );
}

function LegacyMatchSummary({
  match,
  players,
  userId,
  onBack,
}: {
  match: MatchRow;
  players: PlayerRow[];
  userId: string | null;
  onBack: () => void;
}) {
  const mine = players.find((p) => p.userId === userId) ?? players[0];
  const other = players.find((p) => p !== mine) ?? players[1];
  return (
    <div className="pm-legacy">
      <h2>Match Summary</h2>
      <p className="pm-legacy-notice">
        Detailed board unavailable for older matches — this match predates the
        full postgame snapshot.
      </p>
      <ul className="pm-legacy-stats">
        <li><strong>{mine.name}</strong> ({mine.character}) — Mission {mine.mission}, Damage {mine.damage}</li>
        <li><strong>{other.name}</strong> ({other.character}) — Mission {other.mission}, Damage {other.damage}</li>
        <li>Turns: {match.turnCount ?? "—"} · Victory: {match.victoryType ?? "—"}</li>
      </ul>
      <button className="gg-btn gg-btn-ghost" onClick={onBack}>Back</button>
    </div>
  );
}
