import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { BotLogEntry } from "../types/game";
import { Card } from "./Card";

interface Props {
  queue: BotLogEntry[];
  onDone: () => void;
}

const FLASH_DURATION = 1100;

function labelFor(actionType?: string): string[] {
  switch (actionType) {
    case "buy":
    case "buy_eliminate":
    case "buy_with_boxings":
    case "buy_elim_boxings":
      return ["BOUGHT"];
    case "burn_card":
      return ["BURNED"];
    case "refresh_metal":
      return ["REFRESHED"];
    default:
      return ["PLAYED"];
  }
}

export function CardFlashOverlay({ queue, onDone }: Props) {
  const timerRef = useRef<number | null>(null);
  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onDone();
      timerRef.current = null;
    }, FLASH_DURATION);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [current, onDone]);

  if (!current || !current.card) return null;

  const words = labelFor(current.actionType);

  return createPortal(
    <div className="card-flash-overlay">
      <div className="card-flash-inner" key={`${current.turn}-${current.card.id}`}>
        <Card card={current.card} baseWidth={290} noTypeBorder />
        <div className="card-flash-label">
          {words.map((w) => <div key={w} className="card-flash-word">{w}</div>)}
        </div>
      </div>
    </div>,
    document.body,
  );
}
