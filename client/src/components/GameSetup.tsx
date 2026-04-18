import { useState } from "react";
import { FeedbackModal } from "./FeedbackModal";

const CHARACTERS = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
const CHARACTER_OPTIONS = ["Random", ...CHARACTERS];
const BOT_TYPES = ["twonkyV2", "twonky", "synergy", "random", "hammer"];

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface Props {
  onStart: (
    playerName: string,
    character: string,
    opponentType: string,
    opponentCharacter: string,
    botFirst: boolean,
    testDeck: boolean
  ) => void;
  onViewCards: () => void;
  onPlayOnline?: () => void;
}

export function GameSetup({ onStart, onViewCards, onPlayOnline }: Props) {
  const [playerName, setPlayerName] = useState("Player");
  const [character, setCharacter] = useState("Random");
  const [opponentType, setOpponentType] = useState("twonky");
  const [opponentCharacter, setOpponentCharacter] = useState("Random");
  const [botFirst, setBotFirst] = useState(true);
  const [testDeck, setTestDeck] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const handleStart = () => {
    const playerChar = character === "Random" ? pickRandom(CHARACTERS) : character;
    let oppChar = opponentCharacter === "Random" ? pickRandom(CHARACTERS) : opponentCharacter;
    while (oppChar === playerChar) {
      oppChar = pickRandom(CHARACTERS);
    }
    onStart(playerName, playerChar, opponentType, oppChar, botFirst, testDeck);
  };

  return (
    <div className="game-setup">
      <div className="game-setup-mist" aria-hidden="true" />
      <div className="setup-title-block">
        <h1>Mistborn</h1>
        <div className="setup-subtitle">Ash falls · The mists rise</div>
      </div>
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
            {CHARACTER_OPTIONS.map((c) => (
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
            {CHARACTER_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div className="toggle-row">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={botFirst}
              onChange={(e) => setBotFirst(e.target.checked)}
            />
            Bot goes first
          </label>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={testDeck}
              onChange={(e) => setTestDeck(e.target.checked)}
            />
            Test deck
          </label>
        </div>
        <button
          onClick={handleStart}
        >
          Play vs Bot
        </button>
        {onPlayOnline && (
          <button onClick={onPlayOnline}>
            Play Online
          </button>
        )}
        <button className="view-cards-btn" onClick={onViewCards}>
          View All Cards
        </button>
      </div>
      <div className="setup-footer">
        <button className="setup-footer-link" onClick={() => setFeedbackOpen(true)}>
          Send Feedback
        </button>
      </div>
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </div>
  );
}
