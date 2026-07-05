import { useSyncExternalStore } from "react";
import { getIsPhoneLandscape } from "./useMobile";

const DESIGN_WIDTH = 1440;
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.35;

// Phone landscape: the ~390-430px viewport HEIGHT is the binding
// constraint, not width — the board was designed for ~1440x800 at scale 1,
// so scale by height against a 760px design height instead. Desktop keeps
// the original width-based formula untouched.
const PHONE_DESIGN_HEIGHT = 760;
const PHONE_MIN_SCALE = 0.45;
const PHONE_MAX_SCALE = 0.62;

function computeScale() {
  if (getIsPhoneLandscape()) {
    return Math.min(PHONE_MAX_SCALE, Math.max(PHONE_MIN_SCALE, window.innerHeight / PHONE_DESIGN_HEIGHT));
  }
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, window.innerWidth / DESIGN_WIDTH));
}

let currentScale = computeScale();
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  document.documentElement.style.setProperty("--ui-scale", String(currentScale));
  const update = () => {
    const s = computeScale();
    if (s !== currentScale) {
      currentScale = s;
      document.documentElement.style.setProperty("--ui-scale", String(s));
      listeners.forEach((l) => l());
    }
  };
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
}

export function useUIScale(): number {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => currentScale,
  );
}
