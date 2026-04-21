import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { PlayerData } from "../types/game";
import { PlayerInfo } from "./PlayerInfo";
import { TrainingTrack } from "./TrainingTrack";
import { MetalTokens } from "./MetalTokens";

const P = "/cards/httpssteamusercontentaakamaihdnetugc";
const CHARACTER_IMAGES: Record<string, string> = {
  Kelsier: `${P}96933575893836348543557D24AEEE1F012C3CAD29954EF6814E760FC9D.jpg`,
  Vin:     `${P}1345520488082639487110C19C4ACDC3BB4A6DED9A5BF2E459BE380AC1E6.jpg`,
  Marsh:   `${P}109539518916106846249A7A17D9C6BE1C03FF4CA5B6C5F9A8955B0722D3.jpg`,
  Shan:    `${P}175380882799496743833A2ED5F67A4F055DBA77817F4E1E3182320AC66E.jpg`,
  Prodigy: "/cards/Vin%20Prodigy%20copy.png",
};

function usePopupClose(onClose: () => void, skipSelector?: string) {
  useEffect(() => {
    const handle = (e: Event) => {
      if (skipSelector && e.target instanceof Element && e.target.closest(skipSelector)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => {
      window.addEventListener("click", handle, true);
      window.addEventListener("contextmenu", handle, true);
      window.addEventListener("keydown", key);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", handle, true);
      window.removeEventListener("contextmenu", handle, true);
      window.removeEventListener("keydown", key);
    };
  }, [onClose, skipSelector]);
}

export function OpponentDetailPopup({ player, onClose, onOpenCharacter }: {
  player: PlayerData;
  onClose: () => void;
  onOpenCharacter?: () => void;
}) {
  usePopupClose(onClose, ".opp-popup-card-btn");
  const src = CHARACTER_IMAGES[player.character];
  const handleCardClick = () => {
    onOpenCharacter?.();
    onClose();
  };
  return createPortal(
    <div className="log-popup-overlay">
      <div className="log-popup-panel opponent-detail-panel">
        <div className="player-info-with-training">
          <div className="opp-popup-card-wrap">
            {src && (
              <button
                type="button"
                className="opp-popup-card-btn"
                onClick={handleCardClick}
                aria-label="Zoom character card"
              >
                <img src={src} alt={player.character} draggable={false} />
              </button>
            )}
            <PlayerInfo player={player} hideCharacterCard />
          </div>
          <TrainingTrack training={player.training} character={player.character} />
          <MetalTokens player={player} actions={[]} onAction={() => {}} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function CharacterCardPopup({ character, onClose }: { character: string; onClose: () => void }) {
  usePopupClose(onClose);
  const src = CHARACTER_IMAGES[character];
  if (!src) return null;
  return createPortal(
    <div className="log-popup-overlay">
      <div className="character-card-zoom character-card-zoom-modal">
        <img src={src} alt={character} draggable={false} />
      </div>
    </div>,
    document.body,
  );
}
