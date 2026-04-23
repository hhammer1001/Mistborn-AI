import { useState, useEffect } from "react";
import { BOT_TYPES, CHARACTER_OPTIONS, type BotType } from "../data/ministrySigils";
import type { BotSetupConfig } from "../hooks/useMinistryPrefs";

// ── Main menu (4 buttons) ──────────────────────────────

interface MainMenuProps {
  isAuthed: boolean;
  onPickBot: () => void;
  onPickOnline: () => void;
  onPickCards: () => void;
  onPickLog: () => void;
}

export function MainMenuView({ onPickBot, onPickOnline, onPickCards, onPickLog }: MainMenuProps) {
  return (
    <div className="ms-stage-view">
      <div className="ms-play-panel">
        <button onClick={onPickBot}>Play vs Bot</button>
        <button onClick={onPickOnline}>Play Online</button>
        <button onClick={onPickCards}>View Card Gallery</button>
        <button onClick={onPickLog}>See Full Ministry Log</button>
      </div>
    </div>
  );
}

// ── Bot setup ──────────────────────────────────────────

interface BotSetupProps {
  config: BotSetupConfig;
  onBack: () => void;
  onQuickPlay: (cfg: BotSetupConfig) => void;
  onStartCustom: (cfg: BotSetupConfig) => void;
}

export function BotSetupView({ config, onBack, onQuickPlay, onStartCustom }: BotSetupProps) {
  const [draft, setDraft] = useState<BotSetupConfig>(config);

  // Keep draft in sync if prefs change externally (e.g. after Start Match saves).
  useEffect(() => { setDraft(config); }, [config]);

  const previewText = (c: BotSetupConfig) => {
    const self = c.myChar === "Random"  ? "random"  : c.myChar;
    const opp  = c.oppChar === "Random" ? "random"  : c.oppChar;
    const first = c.youFirst ? "you first" : "bot first";
    return { self, opp, bot: c.botType, first };
  };
  const p = previewText(config);

  return (
    <div className="ms-stage-view">
      <div className="ms-setup-card">
        <div className="ms-setup-header">
          <button className="ms-back-link" onClick={onBack}>← Back</button>
          <div className="ms-setup-title">Play vs Bot</div>
        </div>

        <button className="ms-quick-play" onClick={() => onQuickPlay(config)}>
          Quick Play
        </button>
        <div className="ms-qp-preview">
          <b>{p.self}</b> vs <b>{p.opp}</b> · <b>{p.bot}</b> · {p.first}
        </div>

        <div className="ms-or-row"><span>or customize</span></div>

        <div className="ms-setup-form">
          <label>Your Character
            <select
              value={draft.myChar}
              onChange={(e) => setDraft({ ...draft, myChar: e.target.value })}
            >
              {CHARACTER_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>Opponent Character
            <select
              value={draft.oppChar}
              onChange={(e) => setDraft({ ...draft, oppChar: e.target.value })}
            >
              {CHARACTER_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label>Bot Strategy
            <select
              value={draft.botType}
              onChange={(e) => setDraft({ ...draft, botType: e.target.value as BotType })}
            >
              {BOT_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.youFirst}
              onChange={(e) => setDraft({ ...draft, youFirst: e.target.checked })}
            />
            <span>You go first</span>
          </label>
          <button className="start-btn" onClick={() => onStartCustom(draft)}>Start Match</button>
        </div>
      </div>
    </div>
  );
}

// ── Online setup ───────────────────────────────────────

interface OnlineSetupProps {
  isAuthed: boolean;
  onBack: () => void;
  onOpenAuth: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  error?: string | null;
}

export function OnlineSetupView({
  isAuthed, onBack, onOpenAuth, onCreateRoom, onJoinRoom, error,
}: OnlineSetupProps) {
  const [code, setCode] = useState("");

  return (
    <div className="ms-stage-view">
      <div className="ms-setup-card">
        <div className="ms-setup-header">
          <button className="ms-back-link" onClick={onBack}>← Back</button>
          <div className="ms-setup-title">Play Online</div>
        </div>

        {!isAuthed ? (
          <div className="ms-online-guest">
            <p className="ms-online-note">
              Online play requires an open file with the Steel Ministry. Sign in to create or join a room.
            </p>
            <button className="ms-primary-cta" onClick={onOpenAuth}>Open a File (Login)</button>
          </div>
        ) : (
          <div className="ms-online-authed">
            {error && <p className="ms-online-error">{error}</p>}
            <button className="ms-primary-cta" onClick={onCreateRoom}>Create Room</button>
            <div className="ms-or-row"><span>or join with a code</span></div>
            <div className="ms-join-row">
              <input
                type="text"
                placeholder="ABCD"
                maxLength={4}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <button
                disabled={code.length < 4}
                onClick={() => onJoinRoom(code)}
              >
                Join
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
