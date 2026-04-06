import type { PlayerData, GameAction } from "../types/game";

interface Props {
  player: PlayerData;
  isOpponent?: boolean;
  actions?: GameAction[];
  onAction?: (index: number) => void;
}

export function PlayerInfo({ player, isOpponent, actions, onAction }: Props) {
  const charAbilityAction = actions?.find((a) => a.code === 10);
  const thirdAbilityAction = actions?.find((a) => a.code === 11);

  return (
    <div className={`player-info ${isOpponent ? "opponent" : "you"}`}>
      <div className="player-header">
        <strong>{player.name}</strong>
        <span className="character-badge">{player.character}</span>
      </div>
      <div className="player-stats">
        <span className="stat health">HP: {player.health}/40</span>
        <span className="stat">Damage: {player.damage}</span>
        <span className="stat">Money: {player.money}</span>
        <span className="stat">Mission: {player.mission}</span>
        <span className="stat">Boxings: {player.boxings}</span>
        <span className="stat">Training: {player.training}</span>
        <span className="stat">Deck: {player.deckSize}</span>
        <span className="stat">Discard: {player.discardSize}</span>
        {isOpponent && <span className="stat">Hand: {player.handSize}</span>}
      </div>
      {!isOpponent && (
        <div className="char-abilities">
          {charAbilityAction && onAction && (
            <button
              className="action-btn"
              onClick={() => onAction(charAbilityAction.index)}
            >
              Character Ability 1
            </button>
          )}
          {thirdAbilityAction && onAction && (
            <button
              className="action-btn"
              onClick={() => onAction(thirdAbilityAction.index)}
            >
              Character Ability 3
            </button>
          )}
        </div>
      )}
    </div>
  );
}
