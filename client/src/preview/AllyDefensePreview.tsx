import { useState } from "react";
import "../App.css";
import { RankingPanel, type RankingCard } from "../components/RankingPanel";

const ALLIES = [
  { name: "Informant", cardId: 1, health: 2 },
  { name: "Pickpocket", cardId: 2, health: 1 },
  { name: "Seeker", cardId: 3, health: 3 },
];

const CLOUD_ALLY_CARDS: RankingCard[] = [
  { id: 100, name: "Hide", blockValue: 1 },
  { id: 101, name: "Hide", blockValue: 1 },
];

type KillSource =
  | { kind: "damage" }
  | { kind: "card"; name: string }
  | { kind: "ally"; name: string }
  | { kind: "mission"; name: string; tier: number };

// Real K-effect sources in the engine — see `K:` in player.missionFuncs and
// `ability2Effect: "K"` / `special11` in marketDeck.ts. Damage assignment is
// the catch-all "attacker spent X HP of damage to take this ally out."
const SOURCES: { label: string; value: KillSource }[] = [
  { label: "Damage assignment", value: { kind: "damage" } },
  { label: "Card: Assassinate", value: { kind: "card", name: "Assassinate" } },
  { label: "Card: Maelstrom", value: { kind: "card", name: "Maelstrom" } },
  { label: "Ally ability: Coinshot II", value: { kind: "ally", name: "Coinshot" } },
  { label: "Mission first-reached: Luthadel Garrison (rank 4)", value: { kind: "mission", name: "Luthadel Garrison", tier: 4 } },
  { label: "Mission first-reached: Luthadel Garrison (rank 7)", value: { kind: "mission", name: "Luthadel Garrison", tier: 7 } },
  { label: "Mission first-reached: Luthadel Garrison (rank 10)", value: { kind: "mission", name: "Luthadel Garrison", tier: 10 } },
];

function sourceDescription(target: string, src: KillSource): string {
  switch (src.kind) {
    case "damage":
      return `Opponent is spending damage to kill your ${target}.`;
    case "card":
      return src.name === "Maelstrom"
        ? `Opponent played Maelstrom — it's killing all your allies, including ${target}.`
        : `Opponent's ${src.name} is killing your ${target}.`;
    case "ally":
      return `Opponent's ${src.name} is killing your ${target}.`;
    case "mission":
      return `Opponent was first to rank ${src.tier} on ${src.name} — the reward kills your ${target}.`;
  }
}

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "0.6rem",
};
const sectionLabel: React.CSSProperties = {
  color: "var(--gold, #c9a76b)",
  fontSize: "0.8rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  margin: 0,
};
const sectionNote: React.CSSProperties = {
  color: "var(--text-dim, #999)",
  fontSize: "0.72rem",
  margin: 0,
};

export function AllyDefensePreview() {
  const [targetIdx, setTargetIdx] = useState(0);
  const [sourceIdx, setSourceIdx] = useState(0);
  const [hand, setHand] = useState<RankingCard[]>(CLOUD_ALLY_CARDS);
  const [showModal, setShowModal] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const target = ALLIES[targetIdx];
  const source = SOURCES[sourceIdx].value;

  const flashMessage = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 1800);
  };

  const reset = () => {
    setHand(CLOUD_ALLY_CARDS);
    setShowModal(false);
    setFlash(null);
  };

  const handleSelect = (cardId: number | null) => {
    setShowModal(false);
    if (cardId === null) {
      flashMessage(`Let ${target.name} die.`);
      return;
    }
    const card = hand.find((c) => c.id === cardId);
    if (!card) return;
    setHand((h) => h.filter((c) => c.id !== cardId));
    flashMessage(`${card.name} protected ${target.name} from being killed.`);
  };

  return (
    <div style={{ height: "100vh", overflowY: "auto", background: "var(--bg-base, #10111e)", padding: "2rem" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: "2.4rem" }}>
        <header style={{ color: "var(--text)", fontFamily: "var(--font-display, serif)" }}>
          <h1 style={{ margin: 0, fontSize: "1.4rem", letterSpacing: "0.1em" }}>
            Ally Defense Preview
          </h1>
          <p style={{ color: "var(--text-dim, #999)", fontSize: "0.85rem", margin: "0.4rem 0 0" }}>
            Visual-only. Trigger the modal, tap a card to save the targeted ally, or skip to let it die.
          </p>
          <button
            type="button"
            className="action-btn"
            style={{ marginTop: "0.8rem", fontSize: "0.7rem" }}
            onClick={reset}
          >
            Reset hand
          </button>
        </header>

        <section style={sectionStyle}>
          <p style={sectionLabel}>Targeted ally</p>
          <p style={sectionNote}>Pick which ally the (hypothetical) opponent is killing.</p>
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            {ALLIES.map((a, i) => (
              <button
                key={a.cardId}
                type="button"
                className="action-btn"
                style={{
                  fontSize: "0.7rem",
                  background: i === targetIdx ? "rgba(138, 196, 152, 0.18)" : undefined,
                  borderColor: i === targetIdx ? "rgba(138, 196, 152, 0.6)" : undefined,
                }}
                onClick={() => setTargetIdx(i)}
              >
                {a.name} ({a.health} HP)
              </button>
            ))}
          </div>
        </section>

        <section style={sectionStyle}>
          <p style={sectionLabel}>Kill source</p>
          <p style={sectionNote}>How the opponent is killing your ally — surfaces in the modal caption.</p>
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            {SOURCES.map((s, i) => (
              <button
                key={s.label}
                type="button"
                className="action-btn"
                style={{
                  fontSize: "0.7rem",
                  background: i === sourceIdx ? "rgba(138, 196, 152, 0.18)" : undefined,
                  borderColor: i === sourceIdx ? "rgba(138, 196, 152, 0.6)" : undefined,
                }}
                onClick={() => setSourceIdx(i)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>

        <section style={sectionStyle}>
          <p style={sectionLabel}>Hide cards in hand</p>
          <p style={sectionNote}>
            {hand.length === 0
              ? "No cloud-ally cards left. Reset to refill."
              : `${hand.length} available.`}
          </p>
          <button
            type="button"
            className="action-btn"
            style={{ fontSize: "0.75rem", marginTop: "0.4rem" }}
            disabled={hand.length === 0}
            onClick={() => setShowModal(true)}
          >
            Trigger ally-defense modal
          </button>
        </section>

        {flash && (
          <div
            style={{
              padding: "0.8rem 1rem",
              border: "1px solid rgba(138, 196, 152, 0.4)",
              background: "rgba(138, 196, 152, 0.08)",
              color: "var(--text)",
              fontSize: "0.85rem",
              borderRadius: 4,
            }}
          >
            {flash}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <RankingPanel
            variant="ally"
            mode="select"
            cards={hand}
            caption={`${sourceDescription(target.name, source)} Tap a card to discard it and save ${target.name}, or let it die.`}
            actionLabel={`Save ${target.name}`}
            skipLabel={`Let ${target.name} die`}
            onSelect={handleSelect}
          />
        </div>
      )}
    </div>
  );
}
