import { useEffect, useRef, useState } from "react";
import type { LogEntry } from "../hooks/useGame";
import { LogDetailPopup } from "./LogDetailPopup";

interface Props {
  log: LogEntry[];
}

type Row =
  | { kind: "simple"; entry: LogEntry }
  | { kind: "combined"; source: LogEntry; target: LogEntry };

/** Fuzzy-match: burn/flare metal token (or burn card) directly followed by
 *  use_metal whose card uses that same metal. Only merge if consecutive. */
function canCombine(a: LogEntry | undefined, b: LogEntry | undefined): boolean {
  if (!a || !b) return false;
  if (a.isBot !== b.isBot) return false;
  if (a.turn !== b.turn) return false;
  const isSource = a.actionType === "burn_metal" || a.actionType === "flare_metal" || a.actionType === "burn_card";
  if (!isSource) return false;
  if (b.actionType !== "use_metal") return false;
  const sourceMetal = a.metalIndex;
  const targetMetal = b.card?.metal;
  if (sourceMetal === undefined || targetMetal === undefined) return false;
  return sourceMetal === targetMetal;
}

function groupLog(log: LogEntry[]): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < log.length) {
    const cur = log[i];
    const next = log[i + 1];
    if (canCombine(cur, next)) {
      rows.push({ kind: "combined", source: cur, target: next });
      i += 2;
    } else {
      rows.push({ kind: "simple", entry: cur });
      i += 1;
    }
  }
  return rows;
}

function hasDetail(entry: LogEntry): boolean {
  return !!(entry.card || entry.recap || entry.metalIndex !== undefined);
}

export function ActivityLog({ log }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ entry: LogEntry; source?: LogEntry } | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log.length]);

  const rows = groupLog(log);
  let currentTurn = -1;

  return (
    <div className="activity-log">
      <h3>Activity Log</h3>
      <div className="activity-log-scroll">
        {rows.map((row, i) => {
          const turn = row.kind === "simple" ? row.entry.turn : row.target.turn;
          const showTurn = turn !== currentTurn;
          currentTurn = turn;

          if (row.kind === "simple") {
            const entry = row.entry;
            const detail = hasDetail(entry);
            return (
              <div key={i}>
                {showTurn && <div className="log-turn-header">Turn {turn}</div>}
                <div className={`log-entry${entry.isBot ? " log-bot" : ""}${entry.recap ? " log-recap" : ""}`}>
                  <button
                    type="button"
                    className={`log-eye${detail ? "" : " disabled"}`}
                    aria-label={detail ? "Show action detail" : "No detail"}
                    disabled={!detail}
                    onClick={(e) => { e.stopPropagation(); setOpen({ entry }); }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (detail) setOpen({ entry }); }}
                  >
                    <EyeIcon />
                  </button>
                  <span className="log-entry-text">{entry.text}</span>
                </div>
              </div>
            );
          }

          // combined row
          const { source, target } = row;
          const arrowKind = source.actionType === "flare_metal" ? "flare" : "burn";
          // If both entries share the same "X — " prefix, strip it from the target.
          const prefixMatch = source.text.match(/^\s*(.*? — )/);
          const prefix = prefixMatch?.[1];
          const targetText = prefix && target.text.startsWith(prefix)
            ? target.text.slice(prefix.length)
            : target.text;
          return (
            <div key={i}>
              {showTurn && <div className="log-turn-header">Turn {turn}</div>}
              <div className={`log-entry log-combined${target.isBot ? " log-bot" : ""}`}>
                <button
                  type="button"
                  className="log-eye"
                  aria-label="Show action detail"
                  onClick={(e) => { e.stopPropagation(); setOpen({ entry: target, source }); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setOpen({ entry: target, source }); }}
                >
                  <EyeIcon />
                </button>
                <span className="log-entry-text">
                  {source.text} <span className={`log-arrow log-arrow-${arrowKind}`}>→</span> {targetText}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {open && (
        <LogDetailPopup entry={open.entry} source={open.source} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
