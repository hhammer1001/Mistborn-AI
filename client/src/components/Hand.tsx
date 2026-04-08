import { useState, useCallback, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import type { CardData, GameAction } from "../types/game";
import { Card } from "./Card";
import { METAL_ICONS } from "../data/metalIcons";

const METAL_NAMES = ["pewter", "tin", "bronze", "copper", "zinc", "brass", "iron", "steel", "atium"];

interface Props {
  cards: CardData[];
  actions: GameAction[];
  onAction: (index: number) => void;
  deckSize?: number;
  discardSize?: number;
}

interface CardGroup {
  card: CardData;
  count: number;
  allIds: number[];
}

function groupCards(cards: CardData[]): CardGroup[] {
  const groups: CardGroup[] = [];
  const seen = new Map<string, number>();

  for (const card of cards) {
    const existing = seen.get(card.name);
    if (existing !== undefined) {
      groups[existing].count++;
      groups[existing].allIds.push(card.id);
    } else {
      seen.set(card.name, groups.length);
      groups.push({ card, count: 1, allIds: [card.id] });
    }
  }
  return groups;
}

function actionLabel(a: GameAction): { text: string; metalIcon?: string } {
  switch (a.code) {
    case 2: {
      const metalName = a.metalIndex !== undefined ? METAL_NAMES[a.metalIndex] : undefined;
      const icon = metalName ? METAL_ICONS[metalName]?.flat : undefined;
      return { text: "Burn for", metalIcon: icon };
    }
    case 3: {
      const metalName = a.metalIndex !== undefined ? METAL_NAMES[a.metalIndex] : undefined;
      const icon = metalName ? METAL_ICONS[metalName]?.flat : undefined;
      return { text: "Refresh", metalIcon: icon };
    }
    case 4:
      return { text: "Use Metal" };
    default:
      return { text: a.description.split(" ").slice(0, 3).join(" ") };
  }
}

function CardActionMenu({ actions, onAction, onClose, anchorRef }: {
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
    let top = rect.top - menuH - 6;

    const margin = 8;
    if (left + menuW > window.innerWidth - margin) left = window.innerWidth - margin - menuW;
    if (left < margin) left = margin;
    if (top < margin) top = rect.bottom + 6;

    setPos({ left, top });
  }, [anchorRef]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      // Don't close if clicking inside the menu
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
      {actions.map((a) => {
        const label = actionLabel(a);
        return (
          <button
            key={a.index}
            className="hand-action-btn"
            onClick={(e) => { e.stopPropagation(); onAction(a.index); onClose(); }}
            title={a.description}
          >
            <span>{label.text}</span>
            {label.metalIcon && (
              <img className="hand-action-metal-icon" src={label.metalIcon} alt="" draggable={false} />
            )}
          </button>
        );
      })}
    </div>
  );

  return createPortal(menu, document.body);
}

export function Hand({ cards, actions, onAction, deckSize, discardSize }: Props) {
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const getGroupActions = (ids: number[]) =>
    actions.filter((a) => a.cardId !== undefined && ids.includes(a.cardId));

  const groups = groupCards(cards);

  const handleCardClick = useCallback((groupId: number) => {
    setSelectedGroup((prev) => prev === groupId ? null : groupId);
  }, []);

  const handleClose = useCallback(() => {
    setSelectedGroup(null);
  }, []);

  return (
    <div className="hand-zone">
      <h3>Your Hand <span className="subtle">Deck: {deckSize ?? "?"} | Discard: {discardSize ?? "?"}</span></h3>
      <div className="card-row">
        {groups.map((group) => {
          const groupActions = getGroupActions(group.allIds);
          const hasActions = groupActions.length > 0;
          const isSelected = selectedGroup === group.card.id;
          return (
            <div
              key={group.card.id}
              className="hand-card-wrapper"
              ref={(el) => { if (el) cardRefs.current.set(group.card.id, el); }}
            >
              <Card
                card={group.card}
                highlighted={hasActions}
                stackCount={group.count > 1 ? group.count : undefined}
                onClick={hasActions ? () => handleCardClick(group.card.id) : undefined}
              />
              {isSelected && hasActions && (
                <CardActionMenu
                  actions={groupActions}
                  onAction={onAction}
                  onClose={handleClose}
                  anchorRef={{ current: cardRefs.current.get(group.card.id) ?? null }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
