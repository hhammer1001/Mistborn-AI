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

  if (isOpponent) {
    return (
      <div className="player-info opponent">
        <div className="opp-row">
          <div className="opp-identity">
            <strong>{player.name}</strong>
            <span className="opp-character">{player.character}</span>
          </div>
          <div className="opp-stat health">
            <span className="opp-stat-value">{player.health}</span>
            <span className="opp-stat-label">HP</span>
          </div>
          <div className="opp-stat damage">
            <span className="opp-stat-value">{player.damage}</span>
            <span className="opp-stat-label">Dmg</span>
          </div>
          <div className="opp-stat money">
            <span className="opp-stat-value">{player.money}</span>
            <span className="opp-stat-label">Money</span>
          </div>
          <div className="opp-stat mission">
            <span className="opp-stat-value">{player.mission}</span>
            <span className="opp-stat-label">Mission</span>
          </div>
          <div className="opp-stat">
            <span className="opp-stat-value">{player.training}</span>
            <span className="opp-stat-label">Train</span>
          </div>
          <div className="opp-stat">
            <span className="opp-stat-value">{player.boxings}</span>
            <span className="opp-stat-label">Box</span>
          </div>
          <div className="opp-stat">
            <span className="opp-stat-value">{player.handSize}</span>
            <span className="opp-stat-label">Hand</span>
          </div>
          <div className="opp-stat">
            <span className="opp-stat-value">{player.deckSize}</span>
            <span className="opp-stat-label">Deck</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="player-info you">
      <div className="player-header">
        <strong>{player.name}</strong>
      </div>
      <div className="player-character">{player.character}</div>
      <div className="player-stats-grid">
        <div className="stat-block health">
          <span className="stat-value">{player.health}</span>
          <span className="stat-label">HP</span>
        </div>
        <div className="stat-block damage">
          <span className="stat-value">{player.damage}</span>
          <span className="stat-label">Damage</span>
        </div>
        <div className="stat-block money">
          <span className="stat-value">{player.money}</span>
          <span className="stat-label">Money</span>
        </div>
        <div className="stat-block mission">
          <span className="stat-value">{player.mission}</span>
          <span className="stat-label">Mission</span>
        </div>
        <div className="stat-block boxings">
          <span className="stat-value">{player.boxings}</span>
          <span className="stat-label">Boxings</span>
        </div>
        <div className="stat-block burns">
          <span className="stat-value">{player.burns}</span>
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
          {(charAbilityAction || thirdAbilityAction) && (
            <div className="char-abilities">
              {charAbilityAction && (
                <button
                  className="action-btn"
                  onClick={() => onAction(charAbilityAction.index)}
                >
                  Char. Ability I
                </button>
              )}
              {thirdAbilityAction && (
                <button
                  className="action-btn"
                  onClick={() => onAction(thirdAbilityAction.index)}
                >
                  Char. Ability III
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
