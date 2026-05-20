import { useEffect, useState } from "react";
import { MinistrySidebar } from "./MinistrySidebar";
import { AuthModal } from "./AuthModal";
import { MetalSigilPicker } from "./MetalSigilPicker";
import { SettingsPopover } from "./SettingsPopover";
import { FeedbackModal } from "./FeedbackModal";
import { MainMenuView, BotSetupView, OnlineSetupView, LandsBotSetupView } from "./MenuStages";
import type { FirstPlayerChoice } from "../hooks/useMinistryPrefs";
import type { LandsBotKind } from "../lands/hooks/useLandsGame";
import { PWAUpdatePrompt } from "./PWAUpdatePrompt";
import { useMinistryPrefs, type BotSetupConfig } from "../hooks/useMinistryPrefs";
import { useMatchHistory } from "../hooks/useMatchHistory";
import type { Room } from "../hooks/useLobby";

type StageView = "menu" | "bot" | "online";

interface Props {
  // Auth state
  isAuthed: boolean;
  userId: string | null;
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
  onViewLands?: () => void;
  /** Open the postgame review for a chronicle row. */
  onSelectMatch?: (matchId: string) => void;
  /** Launch the Lands game directly with a chosen first player and opponent
   *  bot (skips the Lands game's own start screen). Used when the easter-egg
   *  toggle has swapped "Play vs Bot" for the Lands setup. */
  onStartLandsBot?: (firstPlayer: FirstPlayerChoice, botKind: LandsBotKind) => void;
  /** When BLG is enabled, "Play Online" routes to the Lands lobby instead of
   *  the Mistborn online setup. */
  onPickLandsOnline?: () => void;
  // Lobby actions
  room: Room | null;
  onCreateRoom: () => void | Promise<void>;
  onJoinRoom: (code: string) => void | Promise<void>;
  onLeaveRoom: () => void | Promise<void>;
  lobbyError?: string | null;
}

export function MenuShell({
  isAuthed,
  userId,
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
  onViewLands,
  onSelectMatch,
  onStartLandsBot,
  onPickLandsOnline,
  room,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
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

  // Match history feeds the sidebar's chronicle list and W/L tally.
  const entries = useMatchHistory(userId);

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
      <PWAUpdatePrompt />
      <MinistrySidebar
        isAuthed={isAuthed}
        displayName={displayName}
        createdAt={profileCreatedAt}
        sigil={prefs.sigil}
        flared={prefs.flared}
        onOpenSigilPicker={() => setSigilOpen((v) => !v)}
        entries={entries}
        filter={prefs.filter}
        onSelectMatch={onSelectMatch}
        onOpenAuth={() => setAuthOpen(true)}
        onSignOut={signOut}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onOpenSettings={(anchor) => {
          setSettingsAnchor("#" + anchor);
          setSettingsOpen((v) => !v);
        }}
        landsUnlocked={prefs.landsUnlocked}
        onToggleLandsUnlocked={() => prefs.setLandsUnlocked(!prefs.landsUnlocked)}
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
            onPickOnline={
              prefs.landsEnabled && onPickLandsOnline
                ? onPickLandsOnline
                : handleOnlineEntry
            }
            onPickCards={onViewCards}
            onPickLog={onViewMinistryLog}
            // Lands shortcut button — only surfaces when the stamp is
            // unlocked (glowing) AND the BLG setting is active. Toggling the
            // stamp off auto-disables the setting (in useMinistryPrefs).
            onPickLands={
              prefs.landsUnlocked && prefs.landsEnabled ? onViewLands : undefined
            }
          />
        )}
        {view === "bot" && (
          prefs.landsEnabled && onStartLandsBot ? (
            <LandsBotSetupView
              defaultFirstPlayer={prefs.botConfig.firstPlayer}
              onBack={() => setView("menu")}
              onStart={(fp, bk) => {
                // Reuse the same prefs slot for first-player so it persists.
                prefs.setBotConfig({ ...prefs.botConfig, firstPlayer: fp });
                onStartLandsBot(fp, bk);
              }}
            />
          ) : (
            <BotSetupView
              config={prefs.botConfig}
              onBack={() => setView("menu")}
              onQuickPlay={quickPlay}
              onStartCustom={startCustom}
            />
          )
        )}
        {view === "online" && (
          <OnlineSetupView
            isAuthed={isAuthed}
            room={room}
            onBack={() => setView("menu")}
            onOpenAuth={() => setAuthOpen(true)}
            onCreateRoom={onCreateRoom}
            onJoinRoom={onJoinRoom}
            onLeaveRoom={onLeaveRoom}
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
        landsUnlocked={prefs.landsUnlocked}
        landsEnabled={prefs.landsEnabled}
        onLandsEnabledChange={prefs.setLandsEnabled}
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
