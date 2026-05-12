import { useEffect, useRef } from "react";
import { BOT_TYPES, BOT_TYPE_LABELS, VICTORY_TYPES, type BotType, type VictoryType } from "../data/ministrySigils";
import type { LogFilter, LogMode, FirstPlayerFilter } from "../hooks/useMinistryPrefs";

interface Props {
  open: boolean;
  anchorSelector: string;
  filter: LogFilter;
  onFilterChange: (f: LogFilter) => void;
  onClose: () => void;
  // Hidden "Lands" toggle — only renders when the easter-egg flag is set.
  landsUnlocked?: boolean;
  landsEnabled?: boolean;
  onLandsEnabledChange?: (b: boolean) => void;
}

export function SettingsPopover({
  open,
  anchorSelector,
  filter,
  onFilterChange,
  onClose,
  landsUnlocked,
  landsEnabled,
  onLandsEnabledChange,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) {
        const anchor = document.querySelector(anchorSelector);
        if (anchor && anchor.contains(ev.target as Node)) return;
        onClose();
      }
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    const id = window.setTimeout(() => {
      document.addEventListener("click", onDocClick);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, anchorSelector, onClose]);

  const setMode = (mode: LogMode) => onFilterChange({ ...filter, mode });
  const setFirstPlayer = (firstPlayer: FirstPlayerFilter) => onFilterChange({ ...filter, firstPlayer });
  const toggleBot = (b: BotType) => {
    const has = filter.bots.includes(b);
    onFilterChange({ ...filter, bots: has ? filter.bots.filter((x) => x !== b) : [...filter.bots, b] });
  };
  const toggleVictory = (v: VictoryType) => {
    const has = filter.victories.includes(v);
    onFilterChange({ ...filter, victories: has ? filter.victories.filter((x) => x !== v) : [...filter.victories, v] });
  };

  return (
    <div
      ref={rootRef}
      className={`ms-settings-pop${open ? " open" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <h3>Match Log Settings</h3>

      <div className="section">
        <div className="section-label">Show matches</div>
        <div className="ms-seg-row">
          {(["all", "bot", "human"] as LogMode[]).map((m) => (
            <button
              key={m}
              className={filter.mode === m ? "active" : ""}
              onClick={() => setMode(m)}
            >
              {m === "all" ? "All" : m === "bot" ? "Bot" : "Human"}
            </button>
          ))}
        </div>
      </div>

      <div className={`section${filter.mode === "human" ? " disabled" : ""}`}>
        <div className="section-label">Bot strategies</div>
        <div className="ms-checks">
          {BOT_TYPES.map((b) => (
            <label key={b} className="ms-check-item">
              <input type="checkbox" checked={filter.bots.includes(b)} onChange={() => toggleBot(b)} />
              <span>{BOT_TYPE_LABELS[b]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-label">Went first</div>
        <div className="ms-seg-row">
          {(["all", "me", "opp"] as FirstPlayerFilter[]).map((fp) => (
            <button
              key={fp}
              className={filter.firstPlayer === fp ? "active" : ""}
              onClick={() => setFirstPlayer(fp)}
            >
              {fp === "all" ? "All" : fp === "me" ? "You" : "Opponent"}
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-label">Victory type</div>
        <div className="ms-checks">
          {VICTORY_TYPES.map((v) => (
            <label key={v} className="ms-check-item">
              <input type="checkbox" checked={filter.victories.includes(v)} onChange={() => toggleVictory(v)} />
              <span>{v}</span>
            </label>
          ))}
        </div>
      </div>

      {landsUnlocked && onLandsEnabledChange && (
        <div className="section">
          <div className="ms-checks">
            <label className="ms-check-item">
              <input
                type="checkbox"
                checked={!!landsEnabled}
                onChange={(e) => onLandsEnabledChange(e.target.checked)}
              />
              <span>BLG</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
