import { useEffect, useState } from "react";
import { MinistrySidebar, type ChronicleEntry } from "./MinistrySidebar";
import { AuthModal } from "./AuthModal";
import { MetalSigilPicker } from "./MetalSigilPicker";
import { SettingsPopover } from "./SettingsPopover";
import { FeedbackModal } from "./FeedbackModal";
import { MainMenuView, BotSetupView, OnlineSetupView } from "./MenuStages";
import { useMinistryPrefs, type BotSetupConfig } from "../hooks/useMinistryPrefs";

type StageView = "menu" | "bot" | "online";

interface Props {
  // Auth state
  isAuthed: boolean;
  displayName: string | null;
  profileCreatedAt?: number | null;
  authError?: { message: string } | null;
  // Auth actions
  sendMagicCode: (email: string) => Promise<void>;
  verifyMagicCode: (email: string, code: string) => Promise<void>;
  ensureProfile: (name: string) => void;
  signOut: () => void;
  // Menu actions
  onStartBot: (cfg: BotSetupConfig, displayName: string) => void;
  onViewCards: () => void;
  onViewMinistryLog: () => void;
  // Lobby actions
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  lobbyError?: string | null;
}

export function MenuShell({
  isAuthed,
  displayName,
  profileCreatedAt,
  authError,
  sendMagicCode,
  verifyMagicCode,
  ensureProfile,
  signOut,
  onStartBot,
  onViewCards,
  onViewMinistryLog,
  onCreateRoom,
  onJoinRoom,
  lobbyError,
}: Props) {
  const prefs = useMinistryPrefs();

  const [view, setView] = useState<StageView>("menu");
  const [authOpen, setAuthOpen] = useState(false);
  const [sigilOpen, setSigilOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [settingsAnchor, setSettingsAnchor] = useState("#ms-settings-btn");

  // Auto-close auth modal once user becomes authed.
  useEffect(() => {
    if (isAuthed && authOpen) setAuthOpen(false);
  }, [isAuthed, authOpen]);

  // Chronicle data is empty until the DB is wired up for game logs.
  const entries: ChronicleEntry[] = [];

  // When the user clicks Play Online while already in online view, nothing changes;
  // but if they're guest and we land on online, the view's internal gate handles it.

  const handleOnlineEntry = () => {
    setView("online");
  };

  const handleSendCode = async (email: string) => {
    await sendMagicCode(email);
  };
  const handleVerify = async (email: string, code: string) => {
    await verifyMagicCode(email, code);
    // After success, ensure a profile exists with email-prefix name.
    const defaultName = email.split("@")[0];
    ensureProfile(defaultName);
  };

  const quickPlay = (cfg: BotSetupConfig) => {
    onStartBot(cfg, displayName ?? "Guest");
  };
  const startCustom = (cfg: BotSetupConfig) => {
    prefs.setBotConfig(cfg);
    onStartBot(cfg, displayName ?? "Guest");
  };

  return (
    <div className="ms-shell">
      <MinistrySidebar
        isAuthed={isAuthed}
        displayName={displayName}
        createdAt={profileCreatedAt}
        sigil={prefs.sigil}
        flared={prefs.flared}
        onOpenSigilPicker={() => setSigilOpen((v) => !v)}
        entries={entries}
        filter={prefs.filter}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={signOut}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onOpenSettings={(anchor) => {
          setSettingsAnchor("#" + anchor);
          setSettingsOpen((v) => !v);
        }}
      />

      <main className="ms-stage">
        <div>
          <div className="ms-brand">MISTBORN</div>
          <div className="ms-brand-sub">· the deckbuilding game ·</div>
        </div>

        {view === "menu" && (
          <MainMenuView
            isAuthed={isAuthed}
            onPickBot={() => setView("bot")}
            onPickOnline={handleOnlineEntry}
            onPickCards={onViewCards}
            onPickLog={onViewMinistryLog}
          />
        )}
        {view === "bot" && (
          <BotSetupView
            config={prefs.botConfig}
            onBack={() => setView("menu")}
            onQuickPlay={quickPlay}
            onStartCustom={startCustom}
          />
        )}
        {view === "online" && (
          <OnlineSetupView
            isAuthed={isAuthed}
            onBack={() => setView("menu")}
            onOpenAuth={() => setAuthOpen(true)}
            onCreateRoom={onCreateRoom}
            onJoinRoom={onJoinRoom}
            error={lobbyError ?? null}
          />
        )}
      </main>

      {/* Atmospheric ash */}
      <div className="ms-ash-layer" aria-hidden />
      <div className="ms-ash-layer slow" aria-hidden />

      {/* Popovers & modals */}
      <MetalSigilPicker
        open={sigilOpen}
        anchorSelector=".ms-medallion"
        sigil={prefs.sigil}
        flared={prefs.flared}
        onSelect={(k) => { prefs.setSigil(k); setSigilOpen(false); }}
        onToggleFlared={() => prefs.setFlared(!prefs.flared)}
        onClose={() => setSigilOpen(false)}
      />

      <SettingsPopover
        open={settingsOpen}
        anchorSelector={settingsAnchor}
        filter={prefs.filter}
        onFilterChange={prefs.setFilter}
        onClose={() => setSettingsOpen(false)}
      />

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onSendCode={handleSendCode}
        onVerify={handleVerify}
        onContinueAsGuest={() => setAuthOpen(false)}
        error={authError}
      />

      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </div>
  );
}
