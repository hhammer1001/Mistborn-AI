import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import type { CardData, GameAction, PlayerData } from "../types/game";
import { Card } from "./Card";
import { METAL_ICONS } from "../data/metalIcons";
import { MetalChoicePopup } from "./MetalChoicePopup";
import { copyLabelsForHand, nameWithCopy } from "../utils/copyLabels";

const METAL_NAMES = ["pewter", "tin", "bronze", "copper", "zinc", "brass", "iron", "steel", "atium"];
const ATIUM_ICON = "/cards/atium%20token.png";

interface CompositeAllyAction {
  textBefore: string;
  textAfter: string;
  metalIcon?: string;
  isFlare?: boolean;
  title: string;
  firstActionIndex: number;
  secondMatch: { code: number; cardIds?: number[] };
  // When present, clicking the composite opens a MetalChoicePopup instead
  // of firing immediately; chosen metal → first action index via this map.
  // Used for atium-metal allies (Inquisitor, Kandra) so the player can
  // pick what metal to burn atium as, mirroring the Ability III flow.
  metalChoice?: Record<number, number>;
}

interface Props {
  allies: CardData[];
  actions: GameAction[];
  player?: PlayerData;
  onAction: (index: number) => void;
  onCompositeAction?: (firstIndex: number, secondMatch: { code: number; cardIds?: number[] }) => void;
  label: string;
}

function getCompositeAllyActions(
  ally: CardData,
  actions: GameAction[],
  player: PlayerData,
  copyLabels: Map<number, string>,
): CompositeAllyAction[] {
  const composites: CompositeAllyAction[] = [];
  const metal = ally.metal;
  if (metal < 0) return composites; // no metal allies (Noble, Hazekillers, Crewleader)

  // Atium-metal allies (Inquisitor, Kandra): ability is gated by
  // metalBurned[8]. Any "burn atium" path satisfies it while also giving a
  // metal kick of the player's choice — so present a metal-choice popup,
  // mirroring the Ability III "Burn atium + Ab III" flow.
  if (metal === 8) {
    const hasAbility1 = ally.available1 && player.metalBurned[8] === 0;
    const hasAbility2 = ally.available2 && player.metalBurned[8] === 1;
    if (!hasAbility1 && !hasAbility2) return composites;

    const burnAtiumAction = actions.find((a) => a.code === 5 && a.metalIndex === 8);
    const atiumAsActions = actions.filter((a) => a.code === 12);
    if (!burnAtiumAction && atiumAsActions.length === 0) return composites;

    const resolver: Record<number, number> = {};
    for (const a of atiumAsActions) {
      if (a.metalIndex !== undefined) resolver[a.metalIndex] = a.index;
    }
    if (burnAtiumAction) resolver[8] = burnAtiumAction.index;

    if (hasAbility1) {
      composites.push({
        textBefore: "Burn atium",
        textAfter: "+ Ability 1",
        metalIcon: ATIUM_ICON,
        title: `Burn atium as your choice of metal and use ${ally.name}'s first ability`,
        firstActionIndex: -1,
        secondMatch: { code: 8, cardIds: [ally.id] },
        metalChoice: resolver,
      });
    }
    if (hasAbility2) {
      composites.push({
        textBefore: "Burn atium",
        textAfter: "+ Ability 2",
        metalIcon: ATIUM_ICON,
        title: `Burn atium as your choice of metal and use ${ally.name}'s second ability`,
        firstActionIndex: -1,
        secondMatch: { code: 9, cardIds: [ally.id] },
        metalChoice: resolver,
      });
    }
    return composites;
  }

  const metalName = METAL_NAMES[metal];
  const icon = metalName ? METAL_ICONS[metalName]?.flat : undefined;

  // Either path (burn token OR burn card) bumps metalBurned[metal] by 1.
  // Ability 1 fires when metalBurned > 0 → pre-burn must be 0.
  // Ability 2 fires when metalBurned > 1 → pre-burn must be 1.
  const hasAbility1 = ally.available1 && player.metalBurned[metal] === 0;
  const hasAbility2 = ally.available2 && player.metalBurned[metal] === 1;
  if (!hasAbility1 && !hasAbility2) return composites;

  // 1) Burn/Flare a metal TOKEN + ability — unchanged path.
  const burnTokenAction = actions.find((a) => a.code === 5 && a.metalIndex === metal);
  if (burnTokenAction) {
    const burnCount = player.metalTokens.slice(0, 8).filter((t) => t === 1).length + player.metalTokens[8];
    const isFlare = burnCount >= player.burns;
    const verb = isFlare ? "Flare" : "Burn";

    if (hasAbility1) {
      composites.push({
        textBefore: `${verb}`,
        textAfter: "+ Ability 1",
        metalIcon: icon,
        isFlare,
        title: `${verb} ${metalName} and use ${ally.name}'s first ability`,
        firstActionIndex: burnTokenAction.index,
        secondMatch: { code: 8, cardIds: [ally.id] },
      });
    }
    if (hasAbility2) {
      composites.push({
        textBefore: `${verb}`,
        textAfter: "+ Ability 2",
        metalIcon: icon,
        isFlare,
        title: `${verb} ${metalName} and use ${ally.name}'s second ability`,
        firstActionIndex: burnTokenAction.index,
        secondMatch: { code: 9, cardIds: [ally.id] },
      });
    }
  }

  // 2) Burn another CARD from hand for this metal + ability — mirrors the
  //    Hand.tsx composite. Each burnable copy gets its own entry, with
  //    duplicate-name copies disambiguated by their copy letter.
  const burnCardActions = actions.filter(
    (a) => a.code === 2 && a.metalIndex === metal && a.cardId !== undefined,
  );
  for (const burnAction of burnCardActions) {
    const sourceCard = player.hand.find((c) => c.id === burnAction.cardId);
    if (!sourceCard) continue;
    const labeledName = nameWithCopy(sourceCard.name, copyLabels.get(sourceCard.id));

    if (hasAbility1) {
      composites.push({
        textBefore: `Burn ${labeledName}`,
        textAfter: "+ Ability 1",
        metalIcon: icon,
        title: `Burn ${labeledName} for ${metalName} and use ${ally.name}'s first ability`,
        firstActionIndex: burnAction.index,
        secondMatch: { code: 8, cardIds: [ally.id] },
      });
    }
    if (hasAbility2) {
      composites.push({
        textBefore: `Burn ${labeledName}`,
        textAfter: "+ Ability 2",
        metalIcon: icon,
        title: `Burn ${labeledName} for ${metalName} and use ${ally.name}'s second ability`,
        firstActionIndex: burnAction.index,
        secondMatch: { code: 9, cardIds: [ally.id] },
      });
    }
  }

  // 3) Burn an ATIUM TOKEN as this metal + ability — only listed when the
  //    player has an atium token AND a burn slot left (the use_atium action
  //    only exists in `actions` when both hold). Ally metal is already
  //    constrained to 0-7 by the early return above, so this composite is
  //    valid for every interactive ally that needs a metal kick.
  const useAtiumAction = actions.find((a) => a.code === 12 && a.metalIndex === metal);
  if (useAtiumAction) {
    if (hasAbility1) {
      composites.push({
        textBefore: "Burn atium",
        textAfter: "+ Ability 1",
        metalIcon: icon,
        title: `Burn atium as ${metalName} and use ${ally.name}'s first ability`,
        firstActionIndex: useAtiumAction.index,
        secondMatch: { code: 8, cardIds: [ally.id] },
      });
    }
    if (hasAbility2) {
      composites.push({
        textBefore: "Burn atium",
        textAfter: "+ Ability 2",
        metalIcon: icon,
        title: `Burn atium as ${metalName} and use ${ally.name}'s second ability`,
        firstActionIndex: useAtiumAction.index,
        secondMatch: { code: 9, cardIds: [ally.id] },
      });
    }
  }

  return composites;
}

function AllyActionMenu({ allyActions, composites, onAction, onCompositeAction, onMetalChoice, onClose, anchorRef }: {
  allyActions: GameAction[];
  composites: CompositeAllyAction[];
  onAction: (index: number) => void;
  onCompositeAction: (firstIndex: number, secondMatch: { code: number; cardIds?: number[] }) => void;
  onMetalChoice: (composite: CompositeAllyAction) => void;
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
          onClick={(e) => {
            e.stopPropagation();
            if (c.metalChoice) {
              onMetalChoice(c);
            } else {
              onCompositeAction(c.firstActionIndex, c.secondMatch);
            }
            onClose();
          }}
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
  const [metalChoice, setMetalChoice] = useState<{ allyId: number; composite: CompositeAllyAction } | null>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  if (allies.length === 0) return null;

  const isInteractive = !!player && !!onCompositeAction;
  const copyLabels = isInteractive ? copyLabelsForHand(player!.hand) : new Map<number, string>();

  return (
    <div className="ally-zone">
      <h3>{label}</h3>
      <div className="card-row">
        {allies.map((ally) => {
          const allyActions = actions.filter((a) => a.cardId === ally.id && [8, 9].includes(a.code));
          const composites = isInteractive ? getCompositeAllyActions(ally, actions, player!, copyLabels) : [];
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
                  onMetalChoice={(composite) => setMetalChoice({ allyId: ally.id, composite })}
                  onClose={() => setSelectedAlly(null)}
                  anchorRef={{ current: cardRefs.current.get(ally.id) ?? null }}
                />
              )}
              {metalChoice?.allyId === ally.id && isInteractive && (
                <MetalChoicePopup
                  title="Burn atium as..."
                  anchorRef={{ current: cardRefs.current.get(ally.id) ?? null }}
                  onChoose={(metalIndex) => {
                    const idx = metalChoice.composite.metalChoice?.[metalIndex];
                    if (idx !== undefined) {
                      onCompositeAction!(idx, metalChoice.composite.secondMatch);
                    }
                  }}
                  onClose={() => setMetalChoice(null)}
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
