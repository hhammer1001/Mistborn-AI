import { useState, useCallback, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import type { CardData, GameAction, PlayerData } from "../types/game";
import { Card } from "./Card";
import { METAL_ICONS } from "../data/metalIcons";
import { MetalChoicePopup } from "./MetalChoicePopup";

const METAL_NAMES = ["pewter", "tin", "bronze", "copper", "zinc", "brass", "iron", "steel", "atium"];

/** A composite action that fires two sequential API actions */
export interface CompositeAction {
  textBefore: string;
  textAfter: string;
  metalIcon?: string;
  title: string;
  isFlare?: boolean;
  firstActionIndex: number;
  /** Finds the follow-up action in the new action list after the first resolves */
  findSecond: (actions: GameAction[]) => number | undefined;
}

interface Props {
  cards: CardData[];
  actions: GameAction[];
  player: PlayerData;
  onAction: (index: number) => void;
  onCompositeAction: (firstIndex: number, findSecond: (actions: GameAction[]) => number | undefined) => void;
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

function CardActionMenu({ actions, composites, onAction, onCompositeAction, onClose, anchorRef }: {
  actions: GameAction[];
  composites: CompositeAction[];
  onAction: (index: number) => void;
  onCompositeAction: (firstIndex: number, findSecond: (actions: GameAction[]) => number | undefined) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLDivElement | null>;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [showAtiumBurnPopup, setShowAtiumBurnPopup] = useState(false);

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
      {(() => {
        // Group atium card burns (code 2, 9 metals) into single button
        const atiumBurns = actions.filter((a) => a.code === 2 && actions.filter((b) => b.code === 2).length > 2);
        const normalActions = atiumBurns.length > 2
          ? actions.filter((a) => !(a.code === 2 && atiumBurns.includes(a)))
          : actions;

        return (
          <>
            {atiumBurns.length > 2 && (
              <button
                className="hand-action-btn"
                onClick={(e) => { e.stopPropagation(); setShowAtiumBurnPopup(true); }}
                title="Burn this card — choose which metal"
              >
                <span>Burn (choose metal)</span>
              </button>
            )}
            {normalActions.map((a) => {
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
            {showAtiumBurnPopup && (
              <MetalChoicePopup
                title="Burn card as..."
                onChoose={(metalIndex) => {
                  const burnAction = atiumBurns.find((a) => a.metalIndex === metalIndex);
                  if (burnAction) onAction(burnAction.index);
                  onClose();
                }}
                onClose={() => setShowAtiumBurnPopup(false)}
              />
            )}
          </>
        );
      })()}
      {composites.map((c, i) => (
        <button
          key={`composite-${i}`}
          className={`hand-action-btn composite${c.isFlare ? " flare" : ""}`}
          onClick={(e) => { e.stopPropagation(); onCompositeAction(c.firstActionIndex, c.findSecond); onClose(); }}
          title={c.title}
        >
          <span className={c.isFlare ? "flare-text" : ""}>{c.textBefore}</span>
          {c.metalIcon && (
            <img className="hand-action-metal-icon" src={c.metalIcon} alt="" draggable={false} />
          )}
          <span>{c.textAfter}</span>
        </button>
      ))}
    </div>
  );

  return createPortal(menu, document.body);
}

function getCompositeActions(
  card: CardData,
  allIds: number[],
  actions: GameAction[],
  player: PlayerData,
): CompositeAction[] {
  const composites: CompositeAction[] = [];
  if (card.type !== "action" || card.burned) return composites;
  const capacity = card.capacity ?? 0;
  const metalUsed = card.metalUsed ?? 0;
  if (metalUsed >= capacity) return composites;

  // Card already has metal available — no composite needed (code 4 already exists)
  if (player.metalAvailable[card.metal] > 0) return composites;

  const cardMetal = card.metal;

  // 1) "Burn/Flare [metal token] + add to card" — if the token is unburned (code 5 exists)
  const burnTokenAction = actions.find((a) => a.code === 5 && a.metalIndex === cardMetal);
  if (burnTokenAction) {
    const burnCount = player.metalTokens.slice(0, 8).filter((t) => t === 1).length + player.metalTokens[8];
    const isFlare = burnCount >= player.burns;
    const verb = isFlare ? "Flare" : "Burn";
    const metalName = METAL_NAMES[cardMetal];
    const icon = metalName ? METAL_ICONS[metalName]?.flat : undefined;
    composites.push({
      textBefore: verb,
      textAfter: "+ add",
      metalIcon: icon,
      isFlare,
      title: `${verb} ${metalName} token and add to ${card.name}`,
      firstActionIndex: burnTokenAction.index,
      findSecond: (newActions) => {
        // After burning the token, find the "use metal on card" action (code 4) for any of our card IDs
        const match = newActions.find((a) => a.code === 4 && a.cardId !== undefined && allIds.includes(a.cardId));
        return match?.index;
      },
    });
  }

  // 2) "Burn [other card] + add to this card" — if another card can be burned for this metal
  const burnCardActions = actions.filter(
    (a) => a.code === 2 && a.metalIndex === cardMetal && a.cardId !== undefined && !allIds.includes(a.cardId)
  );
  for (const burnAction of burnCardActions) {
    // Find the source card name
    const sourceCard = player.hand.find((c) => c.id === burnAction.cardId);
    const metalName = METAL_NAMES[cardMetal];
    const icon = metalName ? METAL_ICONS[metalName]?.flat : undefined;
    composites.push({
      textBefore: `Burn ${sourceCard?.name ?? "card"}`,
      textAfter: "+ add",
      metalIcon: icon,
      title: `Burn ${sourceCard?.name ?? "card"} for ${metalName} and add to ${card.name}`,
      firstActionIndex: burnAction.index,
      findSecond: (newActions) => {
        const match = newActions.find((a) => a.code === 4 && a.cardId !== undefined && allIds.includes(a.cardId));
        return match?.index;
      },
    });
  }

  return composites;
}

export function Hand({ cards, actions, player, onAction, onCompositeAction, deckSize, discardSize }: Props) {
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
          const composites = getCompositeActions(group.card, group.allIds, actions, player);
          const hasActions = groupActions.length > 0 || composites.length > 0;
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
                  composites={composites}
                  onAction={onAction}
                  onCompositeAction={onCompositeAction}
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
