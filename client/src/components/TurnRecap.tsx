import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { TurnRecap as TurnRecapData } from "../hooks/useGame";

interface Props {
  recap: TurnRecapData | null;
  onDone: () => void;
  /** When true, wait for flashes to finish first. */
  waiting: boolean;
}

const RECAP_DURATION = 2000;

interface Line {
  label: string;
  cls: string;
}

function buildLines(r: TurnRecapData): Line[] {
  const lines: Line[] = [];
  if (r.mission) lines.push({ label: `${r.mission} mission`, cls: "mission" });
  if (r.damageToPlayer) {
    lines.push({ label: `${r.damageToPlayer.amount} damage to ${r.damageToPlayer.name}`, cls: "damage" });
  }
  for (const a of r.damageToAllies ?? []) {
    lines.push({ label: `${a.amount} damage to ${a.name}`, cls: "damage" });
  }
  if (r.trained) lines.push({ label: `${r.trained} trained`, cls: "train" });
  if (r.healed)  lines.push({ label: `${r.healed} heal`, cls: "heal" });
  if (r.boughtCards?.length) {
    lines.push({ label: `Bought ${r.boughtCards.join(", ")}`, cls: "bought" });
  }
  return lines;
}

export function TurnRecap({ recap, onDone, waiting }: Props) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!recap || waiting) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      onDone();
      timerRef.current = null;
    }, RECAP_DURATION);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [recap, waiting, onDone]);

  if (!recap || waiting) return null;

  const lines = buildLines(recap);
  if (lines.length === 0) return null;

  return createPortal(
    <div className="turn-recap-overlay">
      <div className="turn-recap-panel">
        <div className="turn-recap-title">Opponent's turn</div>
        <div className="turn-recap-lines">
          {lines.map((l, i) => (
            <div key={i} className={`turn-recap-line ${l.cls}`}>{l.label}</div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
