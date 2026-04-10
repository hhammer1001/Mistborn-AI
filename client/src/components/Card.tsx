import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import type { CardData } from "../types/game";
import { getCardSprite } from "../data/cardSprites";
import type { CardSprite } from "../data/cardSprites";
import { describeCard } from "../data/abilityText";
import { useUIScale } from "../hooks/useUIScale";

interface Props {
  card: CardData;
  onClick?: () => void;
  highlighted?: boolean;
  highlightColor?: "gold" | "green";
  noTypeBorder?: boolean;
  small?: boolean;
  stackCount?: number;
}

function UprightSprite({ sprite, width }: { sprite: CardSprite; width: number }) {
  const { sheet, col, row } = sprite;
  const cw = sheet.w / sheet.cols;
  const ch = sheet.h / sheet.rows;
  const scale = width / cw;
  const height = ch * scale;
  return (
    <div
      className="card-sprite"
      style={{
        width,
        height,
        backgroundImage: `url(${sheet.src})`,
        backgroundSize: `${sheet.w * scale}px ${sheet.h * scale}px`,
        backgroundPosition: `-${col * cw * scale}px -${row * ch * scale}px`,
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

function RotatedSprite({ sprite, width }: { sprite: CardSprite; width: number }) {
  const { sheet, col, row } = sprite;
  const cw = sheet.w / sheet.cols;
  const ch = sheet.h / sheet.rows;
  const scale = width / ch;
  const height = cw * scale;
  const spriteW = cw * scale;
  const spriteH = ch * scale;
  return (
    <div className="card-sprite" style={{ width, height, position: "relative", overflow: "hidden" }}>
      <div style={{
        width: spriteW,
        height: spriteH,
        backgroundImage: `url(${sheet.src})`,
        backgroundSize: `${sheet.w * scale}px ${sheet.h * scale}px`,
        backgroundPosition: `-${col * cw * scale}px -${row * ch * scale}px`,
        backgroundRepeat: "no-repeat",
        transform: "rotate(-90deg)",
        transformOrigin: "top left",
        position: "absolute",
        top: spriteW,
        left: 0,
      }} />
    </div>
  );
}

function CardTooltip({ card }: { card: CardData }) {
  const metalLabel = card.metalName
    ? card.metalName.charAt(0).toUpperCase() + card.metalName.slice(1)
    : "";
  const lines = describeCard(card);

  return (
    <div className="card-tooltip" onClick={(e) => e.stopPropagation()}>
      <div className="card-tooltip-header">
        <span className="card-tooltip-name">{card.name}</span>
        <span className="card-tooltip-cost">{card.cost}</span>
      </div>
      {metalLabel && card.type !== "funding" && (
        <div className="card-tooltip-metal">{metalLabel}</div>
      )}
      {card.type === "ally" && (
        <div className="card-tooltip-stat">
          HP: {card.health}{card.defender ? "  ·  Defender" : ""}
        </div>
      )}
      <div className="card-tooltip-abilities">
        {lines.map((line, i) => (
          <div key={i} className="card-tooltip-ability">
            {line.label && <span className="card-tooltip-label">{line.label}:</span>}
            <span>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CardDetailPopup({ card, sprite, cardRef, scale }: {
  card: CardData;
  sprite: CardSprite | undefined;
  cardRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const popupCardWidth = 320 * scale;
  const fallbackWidth = 240 * scale;
  const fallbackMinH = 160 * scale;

  useLayoutEffect(() => {
    const cardEl = cardRef.current;
    const popupEl = popupRef.current;
    if (!cardEl || !popupEl) return;

    const cardRect = cardEl.getBoundingClientRect();
    const popupW = popupEl.offsetWidth;
    const popupH = popupEl.offsetHeight;

    // Center the popup horizontally on the card's right edge
    let left = cardRect.right - popupW / 2;
    // Center vertically on the card
    let top = cardRect.top + cardRect.height / 2 - popupH / 2;

    // Clamp to viewport
    const margin = 8;
    if (left + popupW > window.innerWidth - margin) {
      left = window.innerWidth - margin - popupW;
    }
    if (left < margin) left = margin;
    if (top + popupH > window.innerHeight - margin) {
      top = window.innerHeight - margin - popupH;
    }
    if (top < margin) top = margin;

    setPos({ left, top });
  }, [cardRef]);

  const popup = (
    <div
      ref={popupRef}
      className="card-detail-popup"
      style={{
        position: "fixed",
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        opacity: pos ? 1 : 0,
      }}
    >
      <div className="card-detail-preview">
        {sprite ? (
          sprite.rotated
            ? <RotatedSprite sprite={sprite} width={popupCardWidth} />
            : <UprightSprite sprite={sprite} width={popupCardWidth} />
        ) : (
          <div className="card-fallback" style={{ width: fallbackWidth, minHeight: fallbackMinH }}>
            <div className="card-fallback-name">{card.name}</div>
          </div>
        )}
      </div>
      <CardTooltip card={card} />
    </div>
  );

  return createPortal(popup, document.body);
}

export function Card({ card, onClick, highlighted, highlightColor, noTypeBorder, small, stackCount }: Props) {
  const [showTooltip, setShowTooltip] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const sprite = getCardSprite(card.name);
  const scale = useUIScale();
  const cardWidth = (small ? 100 : 160) * scale;
  const spent = card.burned
    || (card.type === "action" && card.capacity !== undefined && card.metalUsed === card.capacity);
  const typeClass = noTypeBorder ? "" : ` card-${card.type}`;
  const hlClass = highlighted ? ` card-highlighted-${highlightColor ?? "gold"}` : "";
  const borderClass = `card-border${typeClass}${hlClass}${spent ? " card-spent" : ""}`;

  // While popup is open, any click (left or right) anywhere closes it
  useEffect(() => {
    if (!showTooltip) return;
    const close = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setShowTooltip(false);
    };
    window.addEventListener("click", close, true);
    window.addEventListener("contextmenu", close, true);
    return () => {
      window.removeEventListener("click", close, true);
      window.removeEventListener("contextmenu", close, true);
    };
  }, [showTooltip]);

  const handleContext = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowTooltip((v) => !v);
  }, []);

  const handleClick = useCallback(() => {
    if (showTooltip) {
      setShowTooltip(false);
      return;
    }
    onClick?.();
  }, [showTooltip, onClick]);

  return (
    <div className="card-wrapper" onContextMenu={handleContext} onClick={handleClick}>
      <div ref={cardRef} className={borderClass} title={card.name}>
        {sprite ? (
          sprite.rotated
            ? <RotatedSprite sprite={sprite} width={cardWidth} />
            : <UprightSprite sprite={sprite} width={cardWidth} />
        ) : (
          <div className="card-fallback" style={{ width: cardWidth }}>
            <div className="card-fallback-name">{card.name}</div>
            <div className="card-fallback-cost">{card.cost}</div>
            <div className="card-fallback-metal">{card.metalName}</div>
          </div>
        )}
        {(card.burned || card.defender) && (
          <div className="card-badges">
            {card.burned && <span className="badge burned">Burned</span>}
            {card.defender && <span className="badge defender">Def</span>}
          </div>
        )}
        {stackCount && <div className="card-stack-count">{stackCount}</div>}
      </div>
      {showTooltip && <CardDetailPopup card={card} sprite={sprite} cardRef={cardRef} scale={scale} />}
    </div>
  );
}
