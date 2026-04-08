import type { PlayerData, GameAction } from "../types/game";
import { METAL_ICONS } from "../data/metalIcons";

const ATIUM_ICON = "/cards/atium%20token.png";

interface Props {
  player: PlayerData;
  actions: GameAction[];
  onAction: (index: number) => void;
}

export function MetalTokens({ player, actions, onAction }: Props) {
  const burnActions = actions.filter((a) => a.code === 5);
  const atiumActions = actions.filter((a) => a.code === 12);
  const atiumBurned = player.metalTokens[8] === 1;
  const atiumDim = player.atium === 0 || atiumBurned;

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

        {/* Atium token */}
        <div
          className={`metal-icon-row atium-token${atiumDim ? " burned" : ""}`}
          title={`Atium: ${player.atium} tokens, ${player.metalBurned[8]} used this turn`}
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
    </div>
  );
}
