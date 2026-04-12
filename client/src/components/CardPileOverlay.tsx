import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { CardData } from "../types/game";
import { Card } from "./Card";
import { useHorizontalScroll } from "../hooks/useHorizontalScroll";

interface Props {
  title: string;
  cards: CardData[];
  onClose: () => void;
}

export function CardPileOverlay({ title, cards, onClose }: Props) {
  const scrollRef = useHorizontalScroll<HTMLDivElement>();

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // Right-click on a card is handled by Card component — don't close
      // Left-click anywhere closes
      if (e.button === 0) {
        onClose();
      }
    };
    // Delay to avoid the opening click from immediately closing
    const timer = setTimeout(() => {
      window.addEventListener("click", handleClick, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", handleClick, true);
    };
  }, [onClose]);

  return createPortal(
    <div className="card-pile-overlay" onContextMenu={(e) => e.preventDefault()}>
      <div className="card-pile-content" onClick={(e) => e.stopPropagation()}>
        <h3>{title} ({cards.length})</h3>
        {cards.length === 0 ? (
          <p className="card-pile-empty">Empty</p>
        ) : (
          <div className="card-pile-scroll" ref={scrollRef}>
            {cards.map((card, i) => (
              <Card key={`${card.id}-${i}`} card={card} />
            ))}
          </div>
        )}
        <div className="card-pile-hint">Click anywhere to close</div>
      </div>
    </div>,
    document.body
  );
}
