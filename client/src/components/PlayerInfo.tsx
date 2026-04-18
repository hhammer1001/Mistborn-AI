import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { createPortal } from "react-dom";
import type { PlayerData, GameAction, CardData } from "../types/game";
import { METAL_ICONS } from "../data/metalIcons";
import { CardPileOverlay } from "./CardPileOverlay";
import { AnimatedNumber } from "./AnimatedNumber";

const METAL_NAMES = ["pewter", "tin", "bronze", "copper", "zinc", "brass", "iron", "steel", "atium"];
const CHARACTER_METAL: Record<string, number> = {
  Kelsier: 7, Vin: 0, Marsh: 2, Shan: 4, Prodigy: 5,
};

const P = "/cards/httpssteamusercontentaakamaihdnetugc";
const CHARACTER_IMAGES: Record<string, string> = {
  Kelsier: `${P}96933575893836348543557D24AEEE1F012C3CAD29954EF6814E760FC9D.jpg`,
  Vin:     `${P}1345520488082639487110C19C4ACDC3BB4A6DED9A5BF2E459BE380AC1E6.jpg`,
  Marsh:   `${P}109539518916106846249A7A17D9C6BE1C03FF4CA5B6C5F9A8955B0722D3.jpg`,
  Shan:    `${P}175380882799496743833A2ED5F67A4F055DBA77817F4E1E3182320AC66E.jpg`,
  Prodigy: "/cards/Vin%20Prodigy%20copy.png",
};

function CharacterCard({ character }: { character: string }) {
  const [zoomed, setZoomed] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const src = CHARACTER_IMAGES[character];

  useLayoutEffect(() => {
    if (!zoomed) { setPos(null); return; }
    const el = imgRef.current;
    const popup = popupRef.current;
    if (!el || !popup) return;
    const rect = el.getBoundingClientRect();
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    let left = rect.right + 8;
    let top = rect.top + rect.height / 2 - ph / 2;
    const m = 8;
    if (left + pw > window.innerWidth - m) left = rect.left - pw - 8;
    if (top + ph > window.innerHeight - m) top = window.innerHeight - m - ph;
    if (top < m) top = m;
    setPos({ left, top });
  }, [zoomed]);

  useEffect(() => {
    if (!zoomed) return;
    const close = (e: MouseEvent) => { e.preventDefault(); setZoomed(false); };
    const t = setTimeout(() => {
      window.addEventListener("click", close, true);
      window.addEventListener("contextmenu", close, true);
    }, 0);
    return () => { clearTimeout(t); window.removeEventListener("click", close, true); window.removeEventListener("contextmenu", close, true); };
  }, [zoomed]);

  if (!src) return null;

  return (
    <>
      <div
        ref={imgRef}
        className="character-card-thumb"
        onContextMenu={(e) => { e.preventDefault(); setZoomed(v => !v); }}
      >
        <img src={src} alt={character} draggable={false} />
      </div>
      {zoomed && createPortal(
        <div
          ref={popupRef}
          className="character-card-zoom"
          style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, opacity: pos ? 1 : 0 }}
        >
          <img src={src} alt={character} draggable={false} />
        </div>,
        document.body
      )}
    </>
  );
}

interface Props {
  player: PlayerData;
  isOpponent?: boolean;
  actions?: GameAction[];
  onAction?: (index: number) => void;
  onCompositeAction?: (firstIndex: number, findSecond: (actions: GameAction[]) => number | undefined) => void;
  discard?: CardData[];
  marketDiscard?: CardData[];
}


export function PlayerInfo({ player, isOpponent, actions, onAction, onCompositeAction, discard, marketDiscard }: Props) {
  const [showDiscard, setShowDiscard] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const charAbilityAction = actions?.find((a) => a.code === 10);
  const thirdAbilityAction = actions?.find((a) => a.code === 11);

  if (isOpponent) {
    return (
      <div className="player-info opponent">
        <div className="opp-row">
          <div className="opp-identity">
            <strong>{player.name}</strong>
            <span className="opp-character">{player.character}</span>
          </div>
          <div className="opp-stat health">
            <span className="opp-stat-value"><AnimatedNumber value={player.health} tone="health" /></span>
            <span className="opp-stat-label">HP</span>
          </div>
          <div className="opp-stat damage">
            <span className="opp-stat-value"><AnimatedNumber value={player.damage} tone="damage" /></span>
            <span className="opp-stat-label">Dmg</span>
          </div>
          <div className="opp-stat money">
            <span className="opp-stat-value"><AnimatedNumber value={player.money} tone="money" /></span>
            <span className="opp-stat-label">Money</span>
          </div>
          <div className="opp-stat mission">
            <span className="opp-stat-value"><AnimatedNumber value={player.mission} tone="mission" /></span>
            <span className="opp-stat-label">Mission</span>
          </div>
          <div className="opp-stat">
            <span className="opp-stat-value"><AnimatedNumber value={player.training} /></span>
            <span className="opp-stat-label">Train</span>
          </div>
          <div className="opp-stat">
            <span className="opp-stat-value"><AnimatedNumber value={player.boxings} tone="money" /></span>
            <span className="opp-stat-label">Box</span>
          </div>
          <div className="opp-stat">
            <span className="opp-stat-value"><AnimatedNumber value={player.handSize} /></span>
            <span className="opp-stat-label">Hand</span>
          </div>
          <div className="opp-stat">
            <span className="opp-stat-value"><AnimatedNumber value={player.deckSize} /></span>
            <span className="opp-stat-label">Deck</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="player-info you">
      <CharacterCard character={player.character} />
      <div className="player-header">
        <strong>{player.name}</strong>
        {(() => {
          const metalIdx = CHARACTER_METAL[player.character];
          const metalName = metalIdx !== undefined ? METAL_NAMES[metalIdx] : undefined;
          const icon = metalName ? METAL_ICONS[metalName]?.flat : undefined;
          return icon ? <img className="player-header-metal" src={icon} alt={metalName} title={metalName} draggable={false} /> : null;
        })()}
      </div>
      <div className="player-stats-grid">
        <div className="stat-block health">
          <span className="stat-value"><AnimatedNumber value={player.health} tone="health" /></span>
          <span className="stat-label">HP</span>
        </div>
        <div className="stat-block damage">
          <span className="stat-value"><AnimatedNumber value={player.damage} tone="damage" /></span>
          <span className="stat-label">Damage</span>
        </div>
        <div className="stat-block money">
          <span className="stat-value"><AnimatedNumber value={player.money} tone="money" /></span>
          <span className="stat-label">Money</span>
        </div>
        <div className="stat-block mission">
          <span className="stat-value"><AnimatedNumber value={player.mission} tone="mission" /></span>
          <span className="stat-label">Mission</span>
        </div>
        <div className="stat-block boxings">
          <span className="stat-value"><AnimatedNumber value={player.boxings} tone="money" /></span>
          <span className="stat-label">Boxings</span>
        </div>
        <div className="stat-block burns">
          <span className="stat-value"><AnimatedNumber value={player.burns} /></span>
          <span className="stat-label">Burns</span>
        </div>
      </div>
      {onAction && (
        <div className="player-action-btns">
          {(() => {
            const buyBoxing = actions?.find((a) => a.code === 15);
            const useBoxing = actions?.find((a) => a.code === 16);
            return (
              <div className="boxing-btns">
                <button
                  className={`action-btn boxing-btn${!buyBoxing ? " disabled" : ""}`}
                  onClick={buyBoxing ? () => onAction(buyBoxing.index) : undefined}
                  disabled={!buyBoxing}
                  title="Spend 2 money to gain 1 boxing"
                >
                  Buy Boxing
                </button>
                <button
                  className={`action-btn boxing-btn${!useBoxing ? " disabled" : ""}`}
                  onClick={useBoxing ? () => onAction(useBoxing.index) : undefined}
                  disabled={!useBoxing}
                  title="Spend 1 boxing to gain 1 money"
                >
                  Use Boxing
                </button>
              </div>
            );
          })()}
          {discard && marketDiscard && (
            <div className="pile-btns">
              <button
                className={`action-btn pile-btn${discard.length === 0 ? " disabled" : ""}`}
                onClick={discard.length > 0 ? () => setShowDiscard(true) : undefined}
                disabled={discard.length === 0}
              >
                Discard ({discard.length})
              </button>
              <button
                className={`action-btn pile-btn${marketDiscard.length === 0 ? " disabled" : ""}`}
                onClick={marketDiscard.length > 0 ? () => setShowTrash(true) : undefined}
                disabled={marketDiscard.length === 0}
              >
                Trash ({marketDiscard.length})
              </button>
            </div>
          )}
          {(() => {
            const metal1 = parseInt(player.ability1metal);
            const burnCount = player.metalTokens.slice(0, 8).filter((t: number) => t === 1).length + player.metalTokens[8];
            const hasBurns = burnCount < player.burns;
            const showAbility1 = player.training >= 5;
            const showAbility3 = player.training >= 13;
            if (!showAbility1 && !showAbility3) return null;

            return (
              <div className="char-abilities">
                {showAbility1 && (() => {
                  const ready = charAbilityAction; // code 10 exists = metal already burned & ability unused
                  const used = !player.charAbility1;
                  const burnAction = actions?.find((a) => a.code === 5 && a.metalIndex === metal1);
                  const canBurn = !!burnAction;
                  const isFlare = canBurn && !hasBurns;

                  if (used) {
                    return <button className="action-btn disabled" disabled>Ability I (used)</button>;
                  }
                  if (ready) {
                    return <button className="action-btn" onClick={() => onAction!(ready.index)}>Use Ability I</button>;
                  }
                  if (canBurn && onCompositeAction) {
                    const verb = isFlare ? "Flare" : "Burn";
                    return (
                      <button
                        className={`action-btn${isFlare ? " flare-btn" : ""}`}
                        onClick={() => onCompositeAction(burnAction!.index, (newActions) =>
                          newActions.find((a) => a.code === 10)?.index
                        )}
                      >
                        {verb} + Ability I
                      </button>
                    );
                  }
                  return <button className="action-btn disabled" disabled>Ability I (no metal)</button>;
                })()}
                {showAbility3 && (() => {
                  const ready = thirdAbilityAction; // code 11 exists
                  const used = !player.charAbility3;
                  const burnAction = actions?.find((a) => a.code === 5 && a.metalIndex === 8);
                  const canBurn = !!burnAction;

                  if (used) {
                    return <button className="action-btn disabled" disabled>Ability III (used)</button>;
                  }
                  if (ready) {
                    return <button className="action-btn" onClick={() => onAction!(ready.index)}>Use Ability III</button>;
                  }
                  if (canBurn && onCompositeAction) {
                    return (
                      <button
                        className="action-btn"
                        onClick={() => onCompositeAction(burnAction!.index, (newActions) =>
                          newActions.find((a) => a.code === 11)?.index
                        )}
                      >
                        Burn + Ability III
                      </button>
                    );
                  }
                  return <button className="action-btn disabled" disabled>Ability III (no atium)</button>;
                })()}
              </div>
            );
          })()}
        </div>
      )}
      {showDiscard && discard && (
        <CardPileOverlay title="Your Discard" cards={discard} onClose={() => setShowDiscard(false)} />
      )}
      {showTrash && marketDiscard && (
        <CardPileOverlay title="Eliminated Cards" cards={marketDiscard} onClose={() => setShowTrash(false)} />
      )}
    </div>
  );
}
