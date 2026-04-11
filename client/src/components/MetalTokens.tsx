import { useState, useRef } from "react";
import type { PlayerData, GameAction } from "../types/game";
import { METAL_ICONS } from "../data/metalIcons";
import { MetalChoicePopup } from "./MetalChoicePopup";

const ATIUM_ICON = "/cards/atium%20token.png";

interface Props {
  player: PlayerData;
  actions: GameAction[];
  onAction: (index: number) => void;
}

export function MetalTokens({ player, actions, onAction }: Props) {
  const [showAtiumPopup, setShowAtiumPopup] = useState(false);
  const atiumRef = useRef<HTMLDivElement>(null);
  const burnActions = actions.filter((a) => a.code === 5);
  const atiumActions = actions.filter((a) => a.code === 12);
  const hasAtiumBurn = atiumActions.length > 0 || burnActions.some((a) => a.metalIndex === 8);
  const atiumDim = player.atium === 0 || !hasAtiumBurn;

  const handleAtiumChoice = (metalIndex: number) => {
    // metal 0-7: use code 12 (atium as that metal)
    // metal 8: use code 5 with metal=8 (atium as atium)
    if (metalIndex < 8) {
      const act = atiumActions.find((a) => a.metalIndex === metalIndex);
      if (act) onAction(act.index);
    } else {
      const act = burnActions.find((a) => a.metalIndex === 8);
      if (act) onAction(act.index);
    }
  };

  return (
    <div className="metal-col-zone">
      <div className="metal-col-header">
        <div className="metal-col-stat">Burns: {player.burns}</div>
      </div>
      <div className="metal-col">
        {player.metalNames.slice(0, 8).map((name, i) => {
          const token = player.metalTokens[i];
          const icons = METAL_ICONS[name];
          const isFlared = token === 2 || token === 4;
          const isBurned = token === 1;
          const src = icons ? (isFlared ? icons.ringed : icons.flat) : "";
          const burnAction = burnActions.find((a) => a.metalIndex === i);
          const atiumAction = atiumActions.find((a) => a.metalIndex === i);
          const isFlareAction = burnAction && !burnAction.description.startsWith("Burn");
          const available = player.metalAvailable[i];

          const handleClick = () => {
            if (burnAction) onAction(burnAction.index);
            else if (atiumAction) onAction(atiumAction.index);
          };

          const clickable = !!(burnAction || atiumAction);

          return (
            <div
              key={name}
              className={
                "metal-icon-row"
                + (isBurned ? " burned" : "")
                + (isFlared ? " flared" : "")
                + (clickable ? " clickable" : "")
                + (isFlareAction ? " flare-action" : "")
              }
              title={`${name} — ${isBurned ? "Burned" : isFlared ? "Flared" : token === 3 ? "Refreshed" : "Ready"} | Available: ${available}`}
              onClick={clickable ? handleClick : undefined}
            >
              {src && (
                <img
                  className="metal-icon-img"
                  src={src}
                  alt={name}
                  draggable={false}
                />
              )}
              <span className={`metal-avail${available > 0 ? " has-metal" : ""}`}>
                {available}
              </span>
            </div>
          );
        })}

        {/* Atium token — click opens metal choice popup */}
        <div
          ref={atiumRef}
          className={`metal-icon-row atium-token${atiumDim ? " burned" : ""}${hasAtiumBurn ? " clickable" : ""}`}
          title={`Atium: ${player.atium} tokens, ${player.metalBurned[8]} used this turn`}
          onClick={hasAtiumBurn ? () => setShowAtiumPopup(true) : undefined}
        >
          <div className="atium-icon-wrap">
            <img
              className="metal-icon-img atium-img"
              src={ATIUM_ICON}
              alt="Atium"
              draggable={false}
            />
            <span className="atium-count">{player.atium}</span>
          </div>
          <span className={`metal-avail${player.metalBurned[8] > 0 ? " has-metal" : ""}`}>
            {player.metalBurned[8]}
          </span>
        </div>
      </div>

      {showAtiumPopup && (
        <MetalChoicePopup
          title="Use atium token as..."
          anchorRef={atiumRef}
          onChoose={handleAtiumChoice}
          onClose={() => setShowAtiumPopup(false)}
        />
      )}
    </div>
  );
}
