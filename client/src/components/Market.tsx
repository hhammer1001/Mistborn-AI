import { useState, useCallback, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import type { MarketData, GameAction } from "../types/game";
import { Card } from "./Card";

interface Props {
  market: MarketData;
  actions: GameAction[];
  onAction: (index: number) => void;
}

function buyLabel(a: GameAction): string {
  switch (a.code) {
    case 6:  return "Buy";
    case 7:  return "Buy + Eliminate";
    case 13: return `Buy (${a.boxingsCost}B)`;
    case 14: return `Buy + Elim (${a.boxingsCost}B)`;
    default: return a.description;
  }
}

function BuyMenu({ actions, onAction, onClose, anchorRef }: {
  actions: GameAction[];
  onAction: (index: number) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;

    const rect = anchor.getBoundingClientRect();
    const menuH = menu.offsetHeight;
    const menuW = menu.offsetWidth;

    let left = rect.left + rect.width / 2 - menuW / 2;
    let top = rect.bottom + 6;

    const margin = 8;
    if (left + menuW > window.innerWidth - margin) left = window.innerWidth - margin - menuW;
    if (left < margin) left = margin;
    if (top + menuH > window.innerHeight - margin) top = rect.top - menuH - 6;

    setPos({ left, top });
  }, [anchorRef]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
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

  const menu = (
    <div
      ref={menuRef}
      className="hand-action-menu"
      style={{
        position: "fixed",
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        opacity: pos ? 1 : 0,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {actions.map((a) => (
        <button
          key={a.index}
          className="hand-action-btn"
          onClick={(e) => { e.stopPropagation(); onAction(a.index); onClose(); }}
          title={a.description}
        >
          {buyLabel(a)}
        </button>
      ))}
    </div>
  );

  return createPortal(menu, document.body);
}

export function Market({ market, actions, onAction }: Props) {
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const getBuyActions = (cardId: number) =>
    actions.filter((a) => a.cardId === cardId && [6, 7, 13, 14].includes(a.code));

  const handleCardClick = useCallback((cardId: number) => {
    setSelectedCard((prev) => prev === cardId ? null : cardId);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedCard(null);
  }, []);

  return (
    <div className="market-zone">
      <h3>
        Market{" "}
        <span className="subtle">
          (Deck: {market.deckSize} | Discard: {market.discardSize})
        </span>
      </h3>
      <div className="card-row">
        {market.hand.map((card) => {
          const buyActions = getBuyActions(card.id);
          const hasBuy = buyActions.length > 0;
          const hasBoxingBuy = buyActions.some((a) => a.code === 13 || a.code === 14);
          const color = hasBoxingBuy ? "gold" : "green";
          const isSelected = selectedCard === card.id;
          return (
            <div
              key={card.id}
              className="market-card-wrapper"
              ref={(el) => { if (el) cardRefs.current.set(card.id, el); }}
            >
              <Card
                card={card}
                highlighted={hasBuy}
                highlightColor={color}
                noTypeBorder
                cropped={card.type !== "ally"}
                baseWidth={160}
                onClick={hasBuy ? () => handleCardClick(card.id) : undefined}
              />
              {isSelected && hasBuy && (
                <BuyMenu
                  actions={buyActions}
                  onAction={onAction}
                  onClose={handleClose}
                  anchorRef={{ current: cardRefs.current.get(card.id) ?? null }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
