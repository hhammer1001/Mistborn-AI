import { useIsPhonePortrait } from "../hooks/useMobile";

/**
 * Full-screen "rotate your device" overlay, shown app-wide on phones held
 * in portrait. The game is landscape-only on phones; there is no portrait
 * layout. Renders null everywhere else (desktop, tablets, phone landscape).
 */
export function RotateGate() {
  const show = useIsPhonePortrait();
  if (!show) return null;

  return (
    <div className="rotate-gate">
      <svg
        className="rotate-gate-icon"
        viewBox="0 0 64 64"
        width="72"
        height="72"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* phone outline, tilted */}
        <rect x="22" y="10" width="20" height="36" rx="3" transform="rotate(90 32 28)" />
        <line x1="18" y1="28" x2="22" y2="28" transform="rotate(90 32 28)" />
        {/* rotation arrow */}
        <path d="M 32 52 A 20 20 0 0 0 52 32" />
        <polyline points="47 32 52 32 52 37" />
      </svg>
      <div className="rotate-gate-text">Rotate your device</div>
      <div className="rotate-gate-sub">Mistborn plays in landscape</div>
    </div>
  );
}
