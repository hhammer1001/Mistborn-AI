import { useSyncExternalStore } from "react";

/**
 * Device-class detection for the mobile experience. Mirrors the module-
 * singleton pattern of useUIScale: state lives at module level, components
 * subscribe via useSyncExternalStore, and CSS branches on classes this
 * module sets on <html>:
 *
 *   .touch            any coarse-pointer device (phones AND tablets)
 *   .phone            coarse pointer + short edge under 500px
 *   .phone-landscape  phone held wide (the supported play orientation)
 *   .phone-portrait   phone held tall (RotateGate covers the app)
 *
 * Tablets get `.touch` only: long-press + touch affordances, desktop layout.
 * Desktop (fine pointer) gets no classes, so mobile.css never applies.
 *
 * `?forceMobile=1` or localStorage.forceMobile = "1" forces isTouch on —
 * needed because headless/desktop preview browsers report `pointer: fine`.
 */

const PHONE_SHORT_EDGE_MAX = 500;

function readForceMobile(): boolean {
  try {
    return (
      new URLSearchParams(window.location.search).get("forceMobile") === "1" ||
      window.localStorage.getItem("forceMobile") === "1"
    );
  } catch {
    return false;
  }
}

interface MobileState {
  isTouch: boolean;
  isPhone: boolean;
  isPhoneLandscape: boolean;
  isPhonePortrait: boolean;
}

function computeState(forced: boolean, coarse: boolean): MobileState {
  const isTouch = forced || coarse;
  const isPhone = isTouch && Math.min(window.innerWidth, window.innerHeight) < PHONE_SHORT_EDGE_MAX;
  const isLandscape = window.innerWidth > window.innerHeight;
  return {
    isTouch,
    isPhone,
    isPhoneLandscape: isPhone && isLandscape,
    isPhonePortrait: isPhone && !isLandscape,
  };
}

let state: MobileState = { isTouch: false, isPhone: false, isPhoneLandscape: false, isPhonePortrait: false };
const listeners = new Set<() => void>();

function applyHtmlClasses(s: MobileState) {
  const cl = document.documentElement.classList;
  cl.toggle("touch", s.isTouch);
  cl.toggle("phone", s.isPhone);
  cl.toggle("phone-landscape", s.isPhoneLandscape);
  cl.toggle("phone-portrait", s.isPhonePortrait);
}

if (typeof window !== "undefined") {
  const coarseQuery = window.matchMedia("(pointer: coarse)");
  const forced = readForceMobile();

  const update = () => {
    const next = computeState(forced, coarseQuery.matches);
    if (
      next.isTouch === state.isTouch &&
      next.isPhone === state.isPhone &&
      next.isPhoneLandscape === state.isPhoneLandscape
    ) return;
    state = next;
    applyHtmlClasses(state);
    listeners.forEach((l) => l());
  };

  state = computeState(forced, coarseQuery.matches);
  applyHtmlClasses(state);
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  coarseQuery.addEventListener("change", update);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useIsTouch(): boolean {
  return useSyncExternalStore(subscribe, () => state.isTouch);
}

export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, () => state.isPhone);
}

export function useIsPhonePortrait(): boolean {
  return useSyncExternalStore(subscribe, () => state.isPhonePortrait);
}

/** Non-React getters for module-level consumers (useUIScale). */
export function getIsTouch(): boolean {
  return state.isTouch;
}

export function getIsPhoneLandscape(): boolean {
  return state.isPhoneLandscape;
}
