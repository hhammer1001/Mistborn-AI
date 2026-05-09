import { useEffect } from "react";
import { createPortal } from "react-dom";
import { getCardSprite } from "../data/cardSprites";
import { UprightSprite, RotatedSprite } from "./Card";
import { useUIScale } from "../hooks/useUIScale";

/** Centered overlay showing a single card sprite at a large size. Used by
 *  contextual eye buttons (e.g. RankingPanel rows) where the card isn't
 *  rendered inline. Click anywhere or hit Escape to close. */
export function CardImagePopup({ name, onClose }: { name: string; onClose: () => void }) {
  const sprite = getCardSprite(name);
  const scale = useUIScale();

  useEffect(() => {
    const close = () => onClose();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => {
      window.addEventListener("click", close, true);
      window.addEventListener("contextmenu", close, true);
      window.addEventListener("keydown", key);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", close, true);
      window.removeEventListener("contextmenu", close, true);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const width = 360 * scale;

  return createPortal(
    <div className="log-popup-overlay">
      <div className="character-card-zoom character-card-zoom-modal">
        {sprite ? (
          sprite.rotated
            ? <RotatedSprite sprite={sprite} width={width} />
            : <UprightSprite sprite={sprite} width={width} />
        ) : (
          <div className="card-fallback" style={{ width, minHeight: width * 1.4 }}>
            <div className="card-fallback-name">{name}</div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
