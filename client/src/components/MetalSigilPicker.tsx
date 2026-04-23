import { useEffect, useRef, useState } from "react";
import { MINISTRY_METALS } from "../data/ministrySigils";

interface Props {
  open: boolean;
  anchorSelector: string;
  sigil: string;
  flared: boolean;
  onSelect: (key: string) => void;
  onToggleFlared: () => void;
  onClose: () => void;
}

export function MetalSigilPicker({ open, anchorSelector, sigil, flared, onSelect, onToggleFlared, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [topPx, setTopPx] = useState<number>(140);

  // Anchor the popover to the right of the medallion.
  useEffect(() => {
    if (!open) return;
    const anchor = document.querySelector(anchorSelector);
    if (anchor instanceof HTMLElement) {
      const rect = anchor.getBoundingClientRect();
      setTopPx(Math.max(24, rect.top + rect.height / 2 - 110));
    }
  }, [open, anchorSelector]);

  // Close on outside click / escape.
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
    // Defer to let the opening click settle.
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

  return (
    <div
      ref={rootRef}
      className={`ms-metal-picker${open ? " open" : ""}`}
      style={{ top: topPx }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="ms-metal-picker-head">Choose your sigil</div>
      <div className="ms-metal-grid">
        {MINISTRY_METALS.map((m) => {
          const isSelected = m.key === sigil;
          const isAtiumFlat = m.key === "atium" && !flared;
          return (
            <button
              key={m.key}
              className={`ms-token-btn${isSelected ? " selected" : ""}`}
              data-metal={m.key}
              data-flared={String(flared)}
              data-atium-flat={isAtiumFlat ? "true" : "false"}
              title={m.label}
              onClick={() => onSelect(m.key)}
            >
              <div className="disc">
                <img src={flared ? m.ringed : m.flat} alt={m.label} />
              </div>
              <div className="label">{m.label}</div>
            </button>
          );
        })}
      </div>
      <div
        className={`ms-flared-row${flared ? " on" : ""}`}
        onClick={onToggleFlared}
        role="switch"
        aria-checked={flared}
      >
        <span>Flared</span>
        <span className="switch" />
      </div>
    </div>
  );
}
