import { useState } from "react";

const CHARACTERS = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
const BOT_TYPES = ["twonky", "random", "focus", "hammer"];

interface Props {
  onStart: (
    playerName: string,
    character: string,
    opponentType: string,
    opponentCharacter: string
  ) => void;
  onViewCards: () => void;
}

export function GameSetup({ onStart, onViewCards }: Props) {
  const [playerName, setPlayerName] = useState("Player");
  const [character, setCharacter] = useState("Kelsier");
  const [opponentType, setOpponentType] = useState("twonky");
  const [opponentCharacter, setOpponentCharacter] = useState("Shan");

  return (
    <div className="game-setup">
      <h1>Mistborn: Card Game</h1>
      <div className="setup-form">
        <label>
          Your Name
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
          />
        </label>
        <label>
          Character
          <select
            value={character}
            onChange={(e) => setCharacter(e.target.value)}
          >
            {CHARACTERS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Opponent Bot
          <select
            value={opponentType}
            onChange={(e) => setOpponentType(e.target.value)}
          >
            {BOT_TYPES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label>
          Opponent Character
          <select
            value={opponentCharacter}
            onChange={(e) => setOpponentCharacter(e.target.value)}
          >
            {CHARACTERS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={() =>
            onStart(playerName, character, opponentType, opponentCharacter)
          }
        >
          Start Game
        </button>
        <button className="view-cards-btn" onClick={onViewCards}>
          View All Cards
        </button>
      </div>
    </div>
  );
}
