import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import type { CardData, GameAction, PlayerData } from "../types/game";
import { Card } from "./Card";
import { METAL_ICONS } from "../data/metalIcons";

const METAL_NAMES = ["pewter", "tin", "bronze", "copper", "zinc", "brass", "iron", "steel", "atium"];

interface CompositeAllyAction {
  textBefore: string;
  textAfter: string;
  metalIcon?: string;
  isFlare?: boolean;
  title: string;
  firstActionIndex: number;
  findSecond: (actions: GameAction[]) => number | undefined;
}

interface Props {
  allies: CardData[];
  actions: GameAction[];
  player?: PlayerData;
  onAction: (index: number) => void;
  onCompositeAction?: (firstIndex: number, findSecond: (actions: GameAction[]) => number | undefined) => void;
  label: string;
}

function getCompositeAllyActions(
  ally: CardData,
  actions: GameAction[],
  player: PlayerData,
): CompositeAllyAction[] {
  const composites: CompositeAllyAction[] = [];
  const metal = ally.metal;
  if (metal < 0 || metal >= 8) return composites; // no metal allies (Noble, Hazekillers, Crewleader)

  const metalName = METAL_NAMES[metal];
  const icon = metalName ? METAL_ICONS[metalName]?.flat : undefined;

  // Check if burn/flare token action exists for this metal
  const burnTokenAction = actions.find((a) => a.code === 5 && a.metalIndex === metal);
  if (!burnTokenAction) return composites;

  const burnCount = player.metalTokens.slice(0, 8).filter((t) => t === 1).length + player.metalTokens[8];
  const isFlare = burnCount >= player.burns;
  const verb = isFlare ? "Flare" : "Burn";

  // Ability 1: needs metalBurned > 0, available1 must be true
  const hasAbility1 = ally.available1 && player.metalBurned[metal] === 0;
  if (hasAbility1) {
    composites.push({
      textBefore: `${verb}`,
      textAfter: "+ Ability 1",
      metalIcon: icon,
      isFlare,
      title: `${verb} ${metalName} and use ${ally.name}'s first ability`,
      firstActionIndex: burnTokenAction.index,
      findSecond: (newActions) =>
        newActions.find((a) => a.code === 8 && a.cardId === ally.id)?.index,
    });
  }

  // Ability 2: needs metalBurned > 1, available2 must be true
  // One burn adds 1, so we need metalBurned to be exactly 1 (will become 2 after burn)
  const hasAbility2 = ally.available2 && player.metalBurned[metal] === 1;
  if (hasAbility2) {
    composites.push({
      textBefore: `${verb}`,
      textAfter: "+ Ability 2",
      metalIcon: icon,
      isFlare,
      title: `${verb} ${metalName} and use ${ally.name}'s second ability`,
      firstActionIndex: burnTokenAction.index,
      findSecond: (newActions) =>
        newActions.find((a) => a.code === 9 && a.cardId === ally.id)?.index,
    });
  }

  return composites;
}

function AllyActionMenu({ allyActions, composites, onAction, onCompositeAction, onClose, anchorRef }: {
  allyActions: GameAction[];
  composites: CompositeAllyAction[];
  onAction: (index: number) => void;
  onCompositeAction: (firstIndex: number, findSecond: (actions: GameAction[]) => number | undefined) => void;
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
    const m = 8;
    if (left + menuW > window.innerWidth - m) left = window.innerWidth - m - menuW;
    if (left < m) left = m;
    if (top < m) top = rect.bottom + 6;
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
    return () => { clearTimeout(timer); window.removeEventListener("click", close, true); window.removeEventListener("contextmenu", close, true); };
  }, [onClose]);

  const menu = (
    <div
      ref={menuRef}
      className="hand-action-menu"
      style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, opacity: pos ? 1 : 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      {allyActions.map((a) => (
        <button
          key={a.index}
          className="hand-action-btn"
          onClick={(e) => { e.stopPropagation(); onAction(a.index); onClose(); }}
          title={a.description}
        >
          <span>{a.code === 8 ? "Ability 1" : "Ability 2"}</span>
        </button>
      ))}
      {composites.map((c, i) => (
        <button
          key={`composite-${i}`}
          className={`hand-action-btn composite${c.isFlare ? " flare" : ""}`}
          onClick={(e) => { e.stopPropagation(); onCompositeAction(c.firstActionIndex, c.findSecond); onClose(); }}
          title={c.title}
        >
          <span className={c.isFlare ? "flare-text" : ""}>{c.textBefore}</span>
          {c.metalIcon && <img className="hand-action-metal-icon" src={c.metalIcon} alt="" draggable={false} />}
          <span>{c.textAfter}</span>
        </button>
      ))}
    </div>
  );

  return createPortal(menu, document.body);
}

export function AllyZone({ allies, actions, player, onAction, onCompositeAction, label }: Props) {
  const [selectedAlly, setSelectedAlly] = useState<number | null>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  if (allies.length === 0) return null;

  const isInteractive = !!player && !!onCompositeAction;

  return (
    <div className="ally-zone">
      <h3>{label}</h3>
      <div className="card-row">
        {allies.map((ally) => {
          const allyActions = actions.filter((a) => a.cardId === ally.id && [8, 9].includes(a.code));
          const composites = isInteractive ? getCompositeAllyActions(ally, actions, player!) : [];
          const hasMenu = allyActions.length > 0 || composites.length > 0;
          const isSelected = selectedAlly === ally.id;

          return (
            <div
              key={ally.id}
              className="ally-card-wrapper"
              ref={(el) => { if (el) cardRefs.current.set(ally.id, el); }}
            >
              <Card
                card={ally}
                highlighted={hasMenu}
                small
                onClick={hasMenu ? () => setSelectedAlly(prev => prev === ally.id ? null : ally.id) : undefined}
              />
              {isSelected && hasMenu && isInteractive && (
                <AllyActionMenu
                  allyActions={allyActions}
                  composites={composites}
                  onAction={onAction}
                  onCompositeAction={onCompositeAction!}
                  onClose={() => setSelectedAlly(null)}
                  anchorRef={{ current: cardRefs.current.get(ally.id) ?? null }}
                />
              )}
              {/* Fallback for opponent zone or no composites: inline buttons */}
              {!isInteractive && allyActions.length > 0 && (
                <div className="card-actions">
                  {allyActions.map((a) => (
                    <button key={a.index} className="action-btn" onClick={() => onAction(a.index)}>
                      {a.code === 8 ? "Ability 1" : "Ability 2"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
