import { useEffect, useMemo, useRef } from "react";

/**
 * Touch long-press gesture, the mobile stand-in for right-click card zoom.
 *
 * Arms only when e.pointerType === "touch" — mouse and pen pass straight
 * through, so desktop behavior is untouched. The timer cancels on early
 * lift, on pointercancel (the browser claimed the gesture for scrolling,
 * which keeps the hand row's pan-x swipe working), and on movement past
 * the threshold.
 *
 * Deliberately independent of the `contextmenu` event: iOS Safari never
 * fires it. Android DOES fire it on long-press, so components that also
 * handle onContextMenu must guard with wasTouchInteraction() and only
 * preventDefault (no toggle) for touch — otherwise the popup would open
 * via the timer and immediately toggle closed via contextmenu.
 */

interface LongPressOptions {
  delay?: number;
  moveThreshold?: number;
}

export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onClickCapture: (e: React.MouseEvent) => void;
}

// Window-level capture "close on any click" listeners (Card.tsx,
// PlayerInfo.tsx) run before any element-level handler can swallow the
// click that the browser dispatches when the finger lifts after a
// long-press — without this signal the popup they just opened would
// flash and instantly close. They check shouldSuppressClick() and
// ignore clicks inside this window.
let suppressClicksUntil = 0;

export function shouldSuppressClick(): boolean {
  return performance.now() < suppressClicksUntil;
}

// True when the most recent pointerdown anywhere was a touch. Lets
// onContextMenu handlers distinguish a real right-click (toggle) from
// Android's synthesized long-press contextmenu (preventDefault only).
let lastPointerWasTouch = false;

export function wasTouchInteraction(): boolean {
  return lastPointerWasTouch;
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => { lastPointerWasTouch = e.pointerType === "touch"; },
    true,
  );
}

export function useLongPress(
  onLongPress: () => void,
  { delay = 400, moveThreshold = 10 }: LongPressOptions = {},
): LongPressHandlers {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const callbackRef = useRef(onLongPress);

  useEffect(() => {
    callbackRef.current = onLongPress;
  }, [onLongPress]);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  return useMemo(() => {
    const clear = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      startRef.current = null;
    };

    return {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType !== "touch") return;
        firedRef.current = false;
        startRef.current = { x: e.clientX, y: e.clientY };
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          firedRef.current = true;
          suppressClicksUntil = performance.now() + delay + 1500;
          callbackRef.current();
        }, delay);
      },
      onPointerMove: (e: React.PointerEvent) => {
        const start = startRef.current;
        if (!start || timerRef.current === null) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (dx * dx + dy * dy > moveThreshold * moveThreshold) clear();
      },
      onPointerUp: (e: React.PointerEvent) => {
        if (e.pointerType !== "touch") return;
        if (firedRef.current) {
          // The lift after a fired long-press still dispatches a click;
          // tighten the suppression window to just past that click.
          suppressClicksUntil = performance.now() + 350;
        }
        clear();
      },
      onPointerCancel: () => {
        firedRef.current = false;
        clear();
      },
      onClickCapture: (e: React.MouseEvent) => {
        if (!firedRef.current) return;
        // Swallow the click that follows the long-press so it doesn't
        // also trigger the element's tap action (e.g. card action menu).
        firedRef.current = false;
        e.preventDefault();
        e.stopPropagation();
      },
    };
  }, [delay, moveThreshold]);
}
