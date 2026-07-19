import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import type { CardData } from "../types/game";
import { getCardSprite } from "../data/cardSprites";
import type { CardSprite } from "../data/cardSprites";
import { describeCard } from "../data/abilityText";
import { useUIScale } from "../hooks/useUIScale";
import { useLongPress, shouldSuppressClick, wasTouchInteraction } from "../hooks/useLongPress";

interface Props {
  card: CardData;
  onClick?: () => void;
  onDoubleClick?: () => void;
  highlighted?: boolean;
  highlightColor?: "gold" | "green";
  noTypeBorder?: boolean;
  small?: boolean;
  cropped?: boolean;
  baseWidth?: number;
  stackCount?: number;
  /** Letter ("A", "B", …) shown in the top-left corner when the player has
   *  multiple copies of this card in hand. Lets menus and the player refer
   *  to a specific copy. Omit when there's only one copy. */
  copyLabel?: string;
}

export function UprightSprite({ sprite, width }: { sprite: CardSprite; width: number }) {
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

function CroppedSprite({ sprite, width }: { sprite: CardSprite; width: number }) {
  const { sheet, col, row } = sprite;
  const cw = sheet.w / sheet.cols;
  const ch = sheet.h / sheet.rows;
  const scale = width / cw;
  const fullHeight = ch * scale;
  const cropHeight = fullHeight * 0.5;
  return (
    <div
      className="card-sprite card-sprite-cropped"
      style={{
        width,
        height: cropHeight,
        backgroundImage: `url(${sheet.src})`,
        backgroundSize: `${sheet.w * scale}px ${sheet.h * scale}px`,
        backgroundPosition: `-${col * cw * scale}px -${row * ch * scale}px`,
        backgroundRepeat: "no-repeat",
        borderRadius: "4px",
      }}
    />
  );
}

export function RotatedSprite({ sprite, width }: { sprite: CardSprite; width: number }) {
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

export function Card({ card, onClick, onDoubleClick, highlighted, highlightColor, noTypeBorder, small, cropped, baseWidth, stackCount, copyLabel }: Props) {
  const [showTooltip, setShowTooltip] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const touchStartRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const previousTouchTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const touchMovedRef = useRef(false);
  const skipNextClickRef = useRef(false);
  const lastTouchDoubleTapRef = useRef(0);
  const sprite = getCardSprite(card.name);
  const scale = useUIScale();
  const cardWidth = (baseWidth ?? (small ? 80 : 130)) * scale;
  const spent = card.burned
    || (card.type === "action" && card.capacity !== undefined && card.metalUsed === card.capacity);
  const typeClass = noTypeBorder ? "" : ` card-${card.type}`;
  const hlClass = highlighted ? ` card-highlighted-${highlightColor ?? "gold"}` : "";
  const borderClass = `card-border${typeClass}${hlClass}${spent ? " card-spent" : ""}`;

  // While popup is open, any click (left or right) anywhere closes it
  useEffect(() => {
    if (!showTooltip) return;
    const close = (e: MouseEvent) => {
      // Ignore the click dispatched by the finger-lift that ends the
      // long-press which just opened this popup — it would close it
      // in the same gesture.
      if (shouldSuppressClick()) return;
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
    // Android synthesizes contextmenu on long-press; the useLongPress
    // timer already opened the popup, so only suppress here for touch.
    if (wasTouchInteraction()) return;
    setShowTooltip((v) => !v);
  }, []);

  const longPress = useLongPress(() => setShowTooltip(true));

  const handleClick = useCallback(() => {
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false;
      return;
    }
    if (showTooltip) {
      setShowTooltip(false);
      return;
    }
    onClick?.();
  }, [showTooltip, onClick]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    // A mobile double-tap is handled from pointer events below. Some browsers
    // also emit a synthetic dblclick afterwards, which must not play twice.
    if (performance.now() - lastTouchDoubleTapRef.current < 500) return;
    e.preventDefault();
    e.stopPropagation();
    onDoubleClick?.();
  }, [onDoubleClick]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    longPress.onPointerDown(e);
    if (e.pointerType !== "touch" || !onDoubleClick) return;
    touchStartRef.current = { time: performance.now(), x: e.clientX, y: e.clientY };
    touchMovedRef.current = false;
  }, [longPress, onDoubleClick]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    longPress.onPointerMove(e);
    const start = touchStartRef.current;
    if (e.pointerType !== "touch" || !start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (dx * dx + dy * dy > 100) touchMovedRef.current = true;
  }, [longPress]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    longPress.onPointerUp(e);
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (e.pointerType !== "touch" || !start || touchMovedRef.current || !onDoubleClick) return;

    const now = performance.now();
    // Long-press owns slower touch interactions and opens the card preview.
    if (now - start.time > 350) return;

    const previous = previousTouchTapRef.current;
    if (previous && now - previous.time <= 350) {
      const dx = e.clientX - previous.x;
      const dy = e.clientY - previous.y;
      if (dx * dx + dy * dy <= 576) {
        previousTouchTapRef.current = null;
        skipNextClickRef.current = true;
        lastTouchDoubleTapRef.current = now;
        onDoubleClick();
        return;
      }
    }
    previousTouchTapRef.current = { time: now, x: e.clientX, y: e.clientY };
  }, [longPress, onDoubleClick]);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    longPress.onPointerCancel(e);
    touchStartRef.current = null;
    previousTouchTapRef.current = null;
    touchMovedRef.current = false;
  }, [longPress]);

  return (
    <div
      className="card-wrapper"
      onContextMenu={handleContext}
      onClick={handleClick}
      onDoubleClick={onDoubleClick ? handleDoubleClick : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClickCapture={longPress.onClickCapture}
    >
      <div ref={cardRef} className={borderClass} title={card.name}>
        {sprite ? (
          cropped && !sprite.rotated
            ? <CroppedSprite sprite={sprite} width={cardWidth} />
            : sprite.rotated
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
        {copyLabel && <div className="card-copy-label" aria-label={`Copy ${copyLabel}`}>{copyLabel}</div>}
      </div>
      {showTooltip && <CardDetailPopup card={card} sprite={sprite} cardRef={cardRef} scale={scale} />}
    </div>
  );
}
