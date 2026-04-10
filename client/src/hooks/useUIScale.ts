import { useSyncExternalStore } from "react";

const DESIGN_WIDTH = 1440;
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.35;

function computeScale() {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, window.innerWidth / DESIGN_WIDTH));
}

let currentScale = computeScale();
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  document.documentElement.style.setProperty("--ui-scale", String(currentScale));
  window.addEventListener("resize", () => {
    const s = computeScale();
    if (s !== currentScale) {
      currentScale = s;
      document.documentElement.style.setProperty("--ui-scale", String(s));
      listeners.forEach((l) => l());
    }
  });
}

export function useUIScale(): number {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => currentScale,
  );
}
