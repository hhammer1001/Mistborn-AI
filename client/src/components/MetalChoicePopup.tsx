import { useRef, useLayoutEffect, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { METAL_ICONS } from "../data/metalIcons";

const METAL_NAMES = ["pewter", "tin", "bronze", "copper", "zinc", "brass", "iron", "steel", "atium"];
const ATIUM_ICON = "/cards/atium%20token.png";

interface Props {
  title: string;
  anchorRef?: React.RefObject<HTMLElement | null>;
  onChoose: (metalIndex: number) => void;
  onClose: () => void;
}

export function MetalChoicePopup({ title, anchorRef, onChoose, onClose }: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    const margin = 8;

    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      // Try above the anchor, centered horizontally
      let left = rect.left + rect.width / 2 - pw / 2;
      let top = rect.top - ph - 6;

      // Clamp to viewport edges
      if (left + pw > window.innerWidth - margin) left = window.innerWidth - margin - pw;
      if (left < margin) left = margin;
      if (top < margin) top = rect.bottom + 6;
      if (top + ph > window.innerHeight - margin) top = window.innerHeight - margin - ph;

      setPos({ left, top });
    } else {
      // Fallback: center on screen
      setPos({
        left: (window.innerWidth - pw) / 2,
        top: (window.innerHeight - ph) / 2,
      });
    }
  }, [anchorRef]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const timer = setTimeout(() => {
      window.addEventListener("click", close, true);
      window.addEventListener("contextmenu", close, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", close, true);
      window.removeEventListener("contextmenu", close, true);
    };
  }, [onClose]);

  const popup = (
    <div
      ref={popupRef}
      className="metal-choice-popup"
      style={{
        position: "fixed",
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        opacity: pos ? 1 : 0,
        zIndex: 500,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <h3>{title}</h3>
      <div className="metal-choice-grid">
        {METAL_NAMES.map((name, i) => {
          const icon = i < 8 ? METAL_ICONS[name]?.flat : ATIUM_ICON;
          return (
            <button
              key={i}
              className="metal-choice-btn"
              onClick={() => { onChoose(i); onClose(); }}
              title={name}
            >
              {icon && <img src={icon} alt={name} draggable={false} />}
              <span>{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return createPortal(popup, document.body);
}
