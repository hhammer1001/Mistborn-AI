import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type BannerKind = "your" | "opponent" | null;

interface Props {
  banner: BannerKind;
  onDone: () => void;
}

export const BANNER_DURATION = 600;

export function TurnBanner({ banner, onDone }: Props) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!banner) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onDone();
      timerRef.current = null;
    }, BANNER_DURATION);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [banner, onDone]);

  if (!banner) return null;

  const text = banner === "your" ? "YOUR TURN" : "OPPONENT'S TURN";
  return createPortal(
    <div className="turn-banner-overlay">
      <div className={`turn-banner ${banner}`} key={banner}>{text}</div>
    </div>,
    document.body,
  );
}
