import { useState } from "react";
import "../App.css";
import { RankingPanel, type RankingCard } from "../components/RankingPanel";

const SENSE_CARDS: RankingCard[] = [
  { id: 1, name: "Eavesdrop", blockValue: 2 },
  { id: 2, name: "Spy", blockValue: 3 },
  { id: 3, name: "Hyperaware", blockValue: 1 },
];

const CLOUD_CARDS: RankingCard[] = [
  { id: 10, name: "Coppercloud", blockValue: 3 },
  { id: 11, name: "Sneak", blockValue: 3 },
  { id: 12, name: "Hide", blockValue: 5 },
];

const INCOMING_DAMAGE = 5;
const ADVANCE_AMOUNT = 1;

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

export function SensePreview() {
  const [ranking, setRanking] = useState<Record<number, number | null>>({});
  const [showSenseModal, setShowSenseModal] = useState(false);
  const [showCloudModal, setShowCloudModal] = useState(false);
  const [senseHand, setSenseHand] = useState<RankingCard[]>(SENSE_CARDS);
  const [cloudHand, setCloudHand] = useState<RankingCard[]>(CLOUD_CARDS);
  const [senseFlash, setSenseFlash] = useState<string | null>(null);
  const [cloudFlash, setCloudFlash] = useState<string | null>(null);
  const flashFor = (set: (v: string | null) => void) => (msg: string) => {
    set(msg);
    window.setTimeout(() => set(null), 1500);
  };
  const flashSense = flashFor(setSenseFlash);
  const flashCloud = flashFor(setCloudFlash);
  const resetHands = () => {
    setSenseHand(SENSE_CARDS);
    setCloudHand(CLOUD_CARDS);
  };

  return (
    <div style={{ height: "100vh", overflowY: "auto", background: "var(--bg-base, #10111e)", padding: "2rem" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: "2.4rem" }}>
        <header style={{ color: "var(--text)", fontFamily: "var(--font-display, serif)" }}>
          <h1 style={{ margin: 0, fontSize: "1.4rem", letterSpacing: "0.1em" }}>
            Defensive Panel Preview
          </h1>
          <p style={{ color: "var(--text-dim, #999)", fontSize: "0.85rem", margin: "0.4rem 0 0" }}>
            Visual-only. No engine wiring. Three real cases stacked + current plain modals at the bottom.
          </p>
          <button
            type="button"
            className="action-btn"
            style={{ marginTop: "0.8rem", fontSize: "0.7rem" }}
            onClick={resetHands}
          >
            Reset hands
          </button>
        </header>

        <section style={sectionStyle}>
          <p style={sectionLabel}>1. Sense — PvE (pre-turn, rank mode)</p>
          <p style={sectionNote}>
            Used in single-player vs bot. Bot turns run synchronously, so the player can't be
            interrupted per advance — they pre-rank instead.
          </p>
          <RankingPanel
            variant="sense"
            mode="rank"
            cards={SENSE_CARDS}
            initialRanking={ranking}
            onChange={setRanking}
          />
          <pre style={{ color: "var(--text-dim, #888)", fontSize: "0.7rem", margin: 0 }}>
            ranking = {JSON.stringify(ranking)}
          </pre>
        </section>

        <section style={sectionStyle}>
          <p style={sectionLabel}>2. Sense — PvP (during turn, toggle mode)</p>
          <p style={sectionNote}>
            Used per-advance in multiplayer. Player picks which card to spend right when the
            opponent advances; caption names the specific mission.
          </p>
          <RankingPanel
            variant="sense"
            mode="toggle"
            cards={senseHand}
            caption={`Opponent is advancing House War.`}
            formatStatus={(selected) => {
              if (senseFlash) return <strong>{senseFlash}</strong>;
              const sumSelected = selected.reduce((s, c) => s + c.blockValue, 0);
              const left = ADVANCE_AMOUNT - sumSelected;
              return (
                <>
                  <strong>{ADVANCE_AMOUNT}</strong> mission currently in pool,{" "}
                  <strong>{left}</strong> mission left after sensing
                </>
              );
            }}
            onSubmit={(ids) => {
              if (ids.length === 0) {
                flashSense("✗ Advance went through");
                return;
              }
              setSenseHand(prev => prev.filter(c => !ids.includes(c.id)));
            }}
          />
        </section>

        <section style={sectionStyle}>
          <p style={sectionLabel}>3. Cloud — PvE & PvP (during turn, toggle mode)</p>
          <p style={sectionNote}>
            Per-damage-event in both single-player and multiplayer. Showing block value per
            card up front fixes the "did the number actually reduce damage?" confusion.
          </p>
          <RankingPanel
            variant="cloud"
            mode="toggle"
            cards={cloudHand}
            caption="Opponent is hitting you."
            formatStatus={(selected) => {
              if (cloudFlash) return <strong>{cloudFlash}</strong>;
              const blocked = selected.reduce((s, c) => s + c.blockValue, 0);
              const taken = Math.max(0, INCOMING_DAMAGE - blocked);
              return (
                <>
                  <strong>{INCOMING_DAMAGE}</strong> damage currently in pool,{" "}
                  <strong>{taken}</strong> damage left after smoking
                </>
              );
            }}
            onSubmit={(ids) => {
              if (ids.length === 0) {
                flashCloud(`✗ Took all ${INCOMING_DAMAGE} damage`);
                return;
              }
              setCloudHand(prev => prev.filter(c => !ids.includes(c.id)));
            }}
          />
        </section>

        <hr style={{ border: 0, borderTop: "1px solid var(--border, #2a2a3e)", margin: "1rem 0" }} />

        <section style={sectionStyle}>
          <p style={sectionLabel}>For comparison — current plain modals</p>
          <p style={sectionNote}>
            What's wired up in App.tsx today. Click to pop them and compare against the panels above.
          </p>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button className="action-btn" onClick={() => setShowSenseModal(true)}>
              Show sense_defense modal
            </button>
            <button className="action-btn" onClick={() => setShowCloudModal(true)}>
              Show cloud_defense modal
            </button>
          </div>
        </section>
      </div>

      {showSenseModal && (
        <div className="modal-overlay" onClick={() => setShowSenseModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Sense Defense</h3>
            <p className="modal-note">
              Opponent is advancing <strong>House War</strong>. Block it with a Sense card?
            </p>
            {SENSE_CARDS.map((c) => (
              <p key={c.id}>
                <strong>{c.name}</strong> — blocks <strong>{c.blockValue}</strong> mission
              </p>
            ))}
            <div className="modal-actions">
              <button className="action-btn" style={{ borderColor: "var(--blue-bright)" }} onClick={() => setShowSenseModal(false)}>
                Use Sense
              </button>
              <button className="action-btn" style={{ borderColor: "var(--text-dim)", opacity: 0.7 }} onClick={() => setShowSenseModal(false)}>
                Skip
              </button>
            </div>
          </div>
        </div>
      )}

      {showCloudModal && (
        <div className="modal-overlay" onClick={() => setShowCloudModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Cloud Defense</h3>
            <p>
              Incoming: <strong>{INCOMING_DAMAGE}</strong> damage! Discard a cloud card to block?
            </p>
            <div className="modal-actions">
              {CLOUD_CARDS.map((c) => (
                <button key={c.id} className="action-btn" style={{ borderColor: "var(--green)" }} onClick={() => setShowCloudModal(false)}>
                  Use {c.name} (block {c.blockValue})
                </button>
              ))}
              <button className="action-btn" style={{ borderColor: "var(--text-dim)", opacity: 0.7 }} onClick={() => setShowCloudModal(false)}>
                Take the damage
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
