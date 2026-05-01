import { useRegisterSW } from "virtual:pwa-register/react";

/** Top-right banner that appears when a new service-worker bundle has been
 *  downloaded but not activated. Clicking the button calls updateSW(true)
 *  which swaps the SW in and reloads the page. We intentionally don't auto-
 *  apply so a mid-game reload never surprises the player. */
export function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err) {
      console.error("SW registration failed:", err);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="pwa-update-prompt" role="status" aria-live="polite">
      <span className="pwa-update-prompt-text">New version available</span>
      <button
        type="button"
        className="pwa-update-prompt-btn"
        onClick={() => void updateServiceWorker(true)}
      >
        Reload
      </button>
      <button
        type="button"
        className="pwa-update-prompt-dismiss"
        aria-label="Dismiss"
        onClick={() => setNeedRefresh(false)}
      >
        ×
      </button>
    </div>
  );
}
