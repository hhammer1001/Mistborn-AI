import { useEffect, useRef, useState } from "react";
import { useLandsGame, type LandsBotKind } from "../hooks/useLandsGame";
import { LAND_TYPES, type GameState, type LandCard as LandCardData, type LandType } from "../engine/types";
import { countersAvailable } from "../engine/session";
import { LandCard, FaceDownPile, ManaIcon } from "./LandCard";
import "./lands.css";

/** Common interface that the Board component consumes. Both the single-player
 *  hook (`useLandsGame`) and the multiplayer hook (`useLandsMultiplayerGame`)
 *  satisfy this shape, so the same Board renders both. */
export interface BoardGameApi {
  state: GameState | null;
  humanSeat: 0 | 1;
  playCard: (cardId: number) => void;
  passMain: () => void;
  declineCounter: () => void;
  counter: (islandId: number, matchId: number) => void;
  resolveMountain: (targetId: number) => void;
  resolveSwamp: (targetId: number) => void;
  resolveForest: (cardId: number) => void;
  resolveIsland: (discardIds: number[], keepOrderIds: number[]) => void;
}

interface Props {
  onExit: () => void;
  /** If provided, skip the start screen and jump straight into a match. */
  autoStart?: {
    humanFirst: boolean;
    botKind?: LandsBotKind;
    opponentName?: string;
  };
  /** Display name for the human player. Used in logs and on-screen labels.
   *  Defaults to "Player" inside the hook if omitted. */
  playerName?: string;
  /** Auth identity for the human player. When set, the finished match gets
   *  logged to `landsMatches` / `landsMatchPlayers`. */
  humanIdentity?: { profileId: string; userId: string; name: string };
}

export function LandsGame({ onExit, autoStart, playerName, humanIdentity }: Props) {
  const game = useLandsGame();
  const [showStart, setShowStart] = useState(!autoStart);

  // Auto-start path: kick off the session immediately on mount, no start screen.
  useEffect(() => {
    if (autoStart) {
      game.start(autoStart.humanFirst, {
        botKind: autoStart.botKind,
        opponentName: autoStart.opponentName,
        playerName,
        humanIdentity,
      });
    }
    return () => game.end();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (showStart || !game.state) {
    if (autoStart) {
      // Mounted with autoStart but state hasn't propagated yet — show a beat.
      return <div className="lands-root"><div className="lands-empty-msg" style={{ margin: "auto" }}>Dealing…</div></div>;
    }
    return (
      <StartScreen
        onStart={(humanFirst) => {
          game.start(humanFirst, { playerName, humanIdentity });
          setShowStart(false);
        }}
        onExit={onExit}
      />
    );
  }

  return <Board game={game} onExit={onExit} />;
}

// ── Start screen ──

function StartScreen({
  onStart,
  onExit,
}: {
  onStart: (humanFirst: boolean) => void;
  onExit: () => void;
}) {
  return (
    <div className="lands-root">
      <div className="lands-start-panel">
        <div className="lands-titleblock">
          <span className="lands-eyebrow">A Compendium of</span>
          <h1 className="lands-title">The Five Lands</h1>
          <div className="lands-title-rule" aria-hidden>❦</div>
          <p className="lands-subtitle">
            An almanac for two — five basic tenets, twenty-five leaves to a deck.
          </p>
        </div>
        <div className="lands-rules">
          <h3>The Rules, in Brief</h3>
          <ul>
            <li>Each turn, draw one leaf. You may play one card from hand, or hold your peace.</li>
            <li>Victory is gathering all five lands together, <em>or</em> five copies of any one.</li>
            <li>
              <strong>Plains</strong> draws.{" "}
              <strong>Mountain</strong> razes a foreign land.{" "}
              <strong>Swamp</strong> peeks at and trims a foreign hand.{" "}
              <strong>Forest</strong> reclaims from the discard.{" "}
              <strong>Island</strong> scrys four off the top of your deck.
            </li>
            <li>
              Counter a foreign play by discarding an Island and a matching copy.
            </li>
          </ul>
        </div>
        <div className="lands-start-actions">
          <button onClick={() => onStart(true)}>You First</button>
          <button onClick={() => onStart(false)}>Opponent First</button>
          <button className="lands-secondary" onClick={onExit}>Main Menu</button>
        </div>
      </div>
    </div>
  );
}

// ── Board ──

export function Board({
  game,
  onExit,
}: {
  game: BoardGameApi;
  onExit: () => void;
}) {
  const state = game.state!;
  const me = state.players[game.humanSeat];
  const opp = state.players[game.humanSeat === 0 ? 1 : 0];
  const isMyTurn = state.activePlayer === game.humanSeat;
  const canPlay = isMyTurn && state.phase === "main";
  /** When set, a "peek at discard pile" modal is open. */
  const [peekPile, setPeekPile] = useState<{ title: string; cards: LandCardData[] } | null>(null);
  /** "View Board" mode for any gameplay-decision modal: counter window,
   *  mountain target, swamp view, forest pick, island scry. Lets the player
   *  scroll through hands; everything else is non-interactive. */
  const [overlayHidden, setOverlayHidden] = useState(false);
  // Reset hidden state whenever the phase changes (a fresh modal shouldn't
  // open already-minimized).
  useEffect(() => {
    setOverlayHidden(false);
  }, [state.phase]);

  // Which phases would show a gameplay modal worth a "view board" toggle?
  // Counter window is for the non-active player; all the target-pick phases
  // belong to the active player.
  const hasGameplayModal =
    (state.phase === "counter_window" && !isMyTurn) ||
    (isMyTurn &&
      (state.phase === "mountain_target" ||
        state.phase === "swamp_view" ||
        state.phase === "forest_pick" ||
        state.phase === "island_scry"));
  const inViewMode = hasGameplayModal && overlayHidden;

  return (
    <div className="lands-root">
      <div className={`lands-board${inViewMode ? " lands-board-viewonly" : ""}`}>
        <div className="lands-board-left">
          {/* Opponent side */}
          <PlayerRow
            player={opp}
            isOpponent
            counts={countByType(opp.inPlay)}
            status={
              !isMyTurn && state.phase === "main"
                ? "Opponent is thinking…"
                : undefined
            }
            onPeekDiscard={
              opp.discard.length > 0
                ? () => setPeekPile({ title: `${opp.name}'s discard pile`, cards: opp.discard })
                : undefined
            }
          />

          {/* You */}
          <PlayerRow
            player={me}
            isMine
            counts={countByType(me.inPlay)}
            status={
              canPlay
                ? "Your turn — play a card, or pass."
                : isMyTurn
                  ? "Resolve effect…"
                  : undefined
            }
            onPeekDiscard={
              me.discard.length > 0
                ? () => setPeekPile({ title: "Your discard pile", cards: me.discard })
                : undefined
            }
          />

          {/* Hand — copies are grouped into overlapping stacks by type so the
              hand stays compact. Overflows scroll horizontally. */}
          <div className="lands-hand-row">
            <div className="lands-hand">
              {me.hand.length === 0 ? (
                <div className="lands-empty-msg">Hand empty</div>
              ) : (
                LAND_TYPES.map((t) => {
                  // Sort unrevealed first, revealed last — DOM order
                  // determines stack order, so revealed cards (with the eye
                  // icon) end up rightmost and topmost in the visual stack.
                  const ofType = me.hand
                    .filter((c) => c.type === t)
                    .sort(
                      (a, b) =>
                        (a.revealedToOpponent ? 1 : 0) -
                        (b.revealedToOpponent ? 1 : 0),
                    );
                  if (ofType.length === 0) return null;
                  return (
                    <div key={t} className="lands-hand-stack">
                      {ofType.map((c, i) => (
                        <div
                          key={c.id}
                          className="lands-hand-stack-card"
                          style={{ marginLeft: i === 0 ? 0 : "-4.4rem" }}
                        >
                          <LandCard
                            card={c}
                            size="md"
                            onClick={canPlay ? () => game.playCard(c.id) : undefined}
                            disabled={!canPlay}
                            showRevealedIcon={c.revealedToOpponent}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
            <div className="lands-hand-actions">
              <button
                className="lands-pass-btn"
                disabled={!canPlay}
                onClick={() => game.passMain()}
              >
                Pass
              </button>
              <button className="lands-secondary lands-pass-btn" onClick={onExit}>
                Main Menu
              </button>
            </div>
          </div>
        </div>

        <div className="lands-board-right">
          <LogPanel log={state.log} humanSeat={game.humanSeat} />
        </div>
      </div>

      {/* Modal overlays */}
      <Overlays
        game={game}
        onExit={onExit}
        overlayHidden={overlayHidden}
        onMinimize={() => setOverlayHidden(true)}
      />

      {/* Floating button to bring the hidden modal back. Lives outside the
          .lands-board wrapper so it stays clickable even when the board
          itself is pointer-events-disabled. */}
      {inViewMode && (
        <button
          className="lands-counter-resume"
          onClick={() => setOverlayHidden(false)}
        >
          ↺ Resume
        </button>
      )}

      {peekPile && (
        <PilePeekModal
          title={peekPile.title}
          cards={peekPile.cards}
          onClose={() => setPeekPile(null)}
        />
      )}
    </div>
  );
}

/** Read-only browser for a discard pile (or any face-up pile of cards).
 *  Shows cards top-of-pile first (most recently added). Scrolls vertically
 *  when the pile is large. */
/** End-of-match plate — full-screen takeover styled as the closing leaf of
 *  a published compendium. Win and loss variants have distinct color
 *  treatments (warm gilt vs muted ember), share the same composition. */
function GameOverScreen({
  state,
  humanSeat,
  onExit,
}: {
  state: GameState;
  humanSeat: 0 | 1;
  onExit: () => void;
}) {
  const youWon = state.winner === humanSeat;
  const winnerSeat = (state.winner ?? 0) as 0 | 1;
  const winner = state.players[winnerSeat];

  return (
    <div className={`lands-gameover ${youWon ? "lands-gameover-win" : "lands-gameover-loss"}`}>
      <div className="lands-gameover-panel">
        <span className="lands-gameover-eyebrow">The Match is Concluded</span>
        <h1 className="lands-gameover-title">
          {youWon ? "Victorious" : "Defeated"}
        </h1>
        <div className="lands-gameover-rule" aria-hidden>
          <span>❦</span>
        </div>
        <p className="lands-gameover-reason">
          <strong>{winner.name}</strong>
          {state.winReason ? ` ${state.winReason}` : ""}.
        </p>

        <div className="lands-gameover-plate">
          <div className="lands-gameover-plate-label">The Winning Tableau</div>
          <div className="lands-gameover-cards">
            {winner.inPlay.length === 0 ? (
              <div className="lands-empty-msg">No lands in play.</div>
            ) : (
              LAND_TYPES.map((t) => {
                const ofType = winner.inPlay.filter((c) => c.type === t);
                if (ofType.length === 0) return null;
                return (
                  <div key={t} className="lands-gameover-stack">
                    {ofType.map((c, i) => (
                      <div
                        key={c.id}
                        className="lands-gameover-stack-card"
                        style={{ marginLeft: i === 0 ? 0 : "-3.2rem" }}
                      >
                        <LandCard card={c} size="sm" />
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="lands-gameover-actions">
          <button onClick={onExit}>Main Menu</button>
        </div>
      </div>
    </div>
  );
}

function PilePeekModal({
  title,
  cards,
  onClose,
}: {
  title: string;
  cards: LandCardData[];
  onClose: () => void;
}) {
  // Sorted by canonical WUBRG order (LAND_TYPES) — consistent with how lands
  // are laid out everywhere else in the UI. Within a type, original pile
  // order is preserved.
  const ordered = [...cards].sort((a, b) => {
    const ai = LAND_TYPES.indexOf(a.type);
    const bi = LAND_TYPES.indexOf(b.type);
    return ai - bi;
  });
  return (
    <div className="lands-modal-overlay" onClick={onClose}>
      <div className="lands-modal lands-peek-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title} <span className="lands-peek-count">({cards.length})</span></h2>
        <p className="lands-hint">Read-only.</p>
        <div className="lands-peek-grid">
          {ordered.map((c) => (
            <LandCard key={c.id} card={c} size="md" />
          ))}
          {ordered.length === 0 && <div className="lands-empty-msg">Pile is empty.</div>}
        </div>
        <div className="lands-modal-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** Tiny grid showing the count of each land type in a pile (e.g. discard).
 *  5 columns × 2 rows: mana icon on top, count below. Sized to fit above a
 *  small pile card without exceeding its width. */
function PileCountStrip({ cards }: { cards: LandCardData[] }) {
  const counts = countByType(cards);
  return (
    <div
      className="lands-pile-strip"
      title={`By type: ${LAND_TYPES.map((t) => `${counts[t]} ${t}`).join(", ")}`}
    >
      {LAND_TYPES.map((t) => (
        <div key={`i-${t}`} className="lands-pile-strip-icon">
          <ManaIcon type={t} size={11} />
        </div>
      ))}
      {LAND_TYPES.map((t) => (
        <div key={`c-${t}`} className="lands-pile-strip-count">{counts[t]}</div>
      ))}
    </div>
  );
}

function PlayerRow({
  player,
  isOpponent,
  isMine,
  counts,
  status,
  onPeekDiscard,
}: {
  player: import("../engine/types").PlayerState;
  isOpponent?: boolean;
  /** True for the human player's side — controls deck-strip visibility. */
  isMine?: boolean;
  counts: Record<LandType, number>;
  status?: string;
  onPeekDiscard?: () => void;
}) {
  return (
    <div className={`lands-player-row ${isOpponent ? "lands-opp" : "lands-me"}`}>
      <div className="lands-player-header">
        <div className="lands-player-name">{player.name}</div>
        <div className="lands-counts">
          {LAND_TYPES.map((t) => {
            // Pulse when this badge represents a win-threat:
            //   ① count ≥ 4 — one more of this type wins by 5-of-a-kind.
            //   ② count = 0 and every other type is already in play — this is
            //      the last missing type for the all-5 win.
            const missingCount = LAND_TYPES.filter((x) => counts[x] === 0).length;
            const fiveThreat = counts[t] >= 4;
            const allFiveThreat = counts[t] === 0 && missingCount === 1;
            const pulse = fiveThreat || allFiveThreat;
            return (
              <span
                key={t}
                className={`lands-count-badge lands-count-${t} ${pulse ? "lands-count-warn" : ""}`}
                title={
                  fiveThreat
                    ? `${counts[t]} ${t}(s) — one more wins by 5 of a kind`
                    : allFiveThreat
                      ? `${counts[t]} ${t}(s) — last type needed for all five`
                      : `${counts[t]} ${t}(s) in play`
                }
              >
                <ManaIcon type={t} size={14} />
                {counts[t]}
              </span>
            );
          })}
        </div>
        {status && <div className="lands-status">{status}</div>}
      </div>

      {/* Opponent's hand renders as face-down cards (revealed ones face-up).
          - Revealed cards group by type into overlapping stacks (face-down
            cards stay individual — they all look identical anyway).
          - Default: cap at 7 *cards*, with surplus collapsed into a "+N" tile.
            Revealed cards are prioritized so the "+N" never hides knowledge
            we already have.
          - When the opponent has more than 7 *revealed* cards (e.g. swamps
            stacking up), switch to horizontal scroll so every revealed card
            stays visible. */}
      {isOpponent && (() => {
        if (player.hand.length === 0) {
          return (
            <div className="lands-opp-hand" aria-label="Opponent's hand">
              <span className="lands-opp-hand-empty">Hand empty</span>
            </div>
          );
        }
        const MAX_VISIBLE = 7;
        const sorted = [...player.hand].sort((a, b) => {
          const ar = a.revealedToOpponent ? 0 : 1;
          const br = b.revealedToOpponent ? 0 : 1;
          return ar - br;
        });
        const revealedCount = sorted.filter((c) => c.revealedToOpponent).length;
        const scrollAll = revealedCount > MAX_VISIBLE;
        const visible = scrollAll ? sorted : sorted.slice(0, MAX_VISIBLE);
        const overflow = scrollAll ? 0 : sorted.length - visible.length;
        const visibleRevealed = visible.filter((c) => c.revealedToOpponent);
        const visibleFaceDown = visible.filter((c) => !c.revealedToOpponent);
        return (
          <div
            className={`lands-opp-hand${scrollAll ? " lands-opp-hand-scroll" : ""}`}
            aria-label="Opponent's hand"
          >
            {LAND_TYPES.map((t) => {
              const ofType = visibleRevealed.filter((c) => c.type === t);
              if (ofType.length === 0) return null;
              return (
                <div key={`r-${t}`} className="lands-opp-stack">
                  {ofType.map((c, i) => (
                    <div
                      key={c.id}
                      className="lands-opp-stack-card"
                      style={{ marginLeft: i === 0 ? 0 : "-3.2rem" }}
                    >
                      <LandCard card={c} size="sm" />
                    </div>
                  ))}
                </div>
              );
            })}
            {visibleFaceDown.map((c) => (
              <LandCard key={c.id} card={c} size="sm" faceDown />
            ))}
            {overflow > 0 && (
              <div
                className="lands-opp-hand-more"
                title={`${overflow} more card${overflow === 1 ? "" : "s"} in hand`}
              >
                +{overflow}
              </div>
            )}
          </div>
        );
      })()}

      <div className="lands-zone-row">
        <div className="lands-inplay">
          {player.inPlay.length === 0 ? (
            <div className="lands-empty-msg">No lands in play</div>
          ) : (
            // Group by type so duplicates stack visually.
            LAND_TYPES.map((t) => {
              const ofType = player.inPlay.filter((c) => c.type === t);
              if (ofType.length === 0) return null;
              return (
                <div key={t} className="lands-stack">
                  {ofType.map((c, i) => (
                    <div
                      key={c.id}
                      className="lands-stack-card"
                      style={{ marginLeft: i === 0 ? 0 : "-3.2rem" }}
                    >
                      <LandCard card={c} size="sm" />
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>
        <div className="lands-piles">
          <div className="lands-pile-col">
            {/* Composition strip is only meaningful for the player's own deck
                — they implicitly know its contents from observing zone moves.
                Showing it for the opponent's deck would leak information. */}
            {isMine && <PileCountStrip cards={player.deck} />}
            <FaceDownPile count={player.deck.length} label="Deck" />
          </div>
          <div className="lands-pile-col">
            <PileCountStrip cards={player.discard} />
            <DiscardPile cards={player.discard} onClick={onPeekDiscard} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DiscardPile({ cards, onClick }: { cards: LandCardData[]; onClick?: () => void }) {
  const top = cards[cards.length - 1];
  const clickable = !!onClick && cards.length > 0;
  return (
    <div
      className={`lands-pile lands-pile-sm${clickable ? " lands-pile-clickable" : ""}`}
      title={cards.length > 0 ? `View discard pile (${cards.length} cards)` : "Discard pile is empty"}
      onClick={clickable ? onClick : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className="lands-pile-stack">
        {top ? (
          <>
            <LandCard card={top} size="sm" />
            <div className="lands-pile-badge">{cards.length}</div>
          </>
        ) : (
          <div className="lands-pile-empty lands-card-sm">discard</div>
        )}
      </div>
    </div>
  );
}

function LogPanel({
  log,
  humanSeat,
}: {
  log: import("../engine/types").LogEntry[];
  humanSeat: 0 | 1;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Auto-stick to the bottom as new entries arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  return (
    <div className="lands-log-panel">
      <div className="lands-log-header">Activity Log</div>
      <div className="lands-log-scroll" ref={scrollRef}>
        {log.map((e, i) => {
          // ownerText is private-knowledge text shown only to the actor —
          // e.g. an Island scry reveals the kept-card list to the player who
          // scryed, while opponents see only the count.
          const display =
            e.ownerText && e.player === humanSeat ? e.ownerText : e.text;
          return (
            <div key={i} className={`lands-log-entry lands-log-p${e.player ?? "none"}`}>
              <span className="lands-log-turn">T{e.turn}</span>
              <span className="lands-log-text">{display}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Overlay modals (one mounts at a time based on phase) ──

function Overlays({
  game,
  onExit,
  overlayHidden,
  onMinimize,
}: {
  game: BoardGameApi;
  onExit: () => void;
  /** When true, hides any gameplay-decision overlay so the player can see
   *  the board. The Board component renders a floating Resume button. */
  overlayHidden: boolean;
  onMinimize: () => void;
}) {
  const state = game.state!;
  const isMine = state.activePlayer === game.humanSeat;
  const phase = state.phase;

  // Game-over takes over the screen with a dedicated end-page plate.
  if (phase === "game_over") {
    return <GameOverScreen state={state} humanSeat={game.humanSeat} onExit={onExit} />;
  }

  // All gameplay-decision overlays disappear when hidden.
  if (overlayHidden) return null;

  if (phase === "counter_window" && !isMine) {
    return <CounterOverlay game={game} onMinimize={onMinimize} />;
  }
  if (phase === "mountain_target" && isMine) {
    return <MountainOverlay game={game} onMinimize={onMinimize} />;
  }
  if (phase === "swamp_view" && isMine) {
    return <SwampOverlay game={game} onMinimize={onMinimize} />;
  }
  if (phase === "forest_pick" && isMine) {
    return <ForestOverlay game={game} onMinimize={onMinimize} />;
  }
  if (phase === "island_scry" && isMine) {
    return <IslandOverlay game={game} onMinimize={onMinimize} />;
  }
  return null;
}

function ModalShell({
  title,
  children,
  onMinimize,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  /** When provided, renders a "View Board" button in the top-right corner
   *  that hides this modal so the player can scroll through hands and the
   *  log. The board becomes inert while hidden; a floating "Resume" button
   *  brings the modal back. */
  onMinimize?: () => void;
  /** Wider modal variant — used for content that wraps two cards per row. */
  wide?: boolean;
}) {
  return (
    <div className="lands-modal-overlay">
      <div className={`lands-modal${wide ? " lands-modal-wide" : ""}`}>
        {onMinimize && (
          <button
            className="lands-secondary lands-modal-view-btn"
            onClick={onMinimize}
          >
            View Board
          </button>
        )}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function CounterOverlay({
  game,
  onMinimize,
}: {
  game: BoardGameApi;
  onMinimize: () => void;
}) {
  const state = game.state!;
  const me = state.players[game.humanSeat];
  const opp = state.players[game.humanSeat === 0 ? 1 : 0];
  const pending = state.pending!;
  const options = countersAvailable(me.hand, pending.card.type);
  const canCounter = options.length > 0;
  const playedType = cap(pending.card.type);
  const hasTarget = !!pending.target;

  // The arrow + verb between the played card and the target. Mountain
  // destroys (target moves to discard); Forest retrieves (target moves into
  // hand). Glyphs face the direction of the card flow.
  const verb = pending.card.type === "mountain" ? "destroys" : "retrieves";
  const arrow = pending.card.type === "mountain" ? "→" : "←";
  const targetCaption =
    pending.card.type === "mountain"
      ? `${opp.name}'s ${pending.target ? cap(pending.target.type) : ""}`
      : `${cap(pending.target?.type ?? "")} from discard`;

  return (
    <ModalShell title={`${opp.name} plays ${playedType} — counter?`} onMinimize={onMinimize}>
      <div className="lands-counter-visual">
        <div className="lands-counter-frame">
          <LandCard card={pending.card} size="md" />
          <div className="lands-counter-card-cap">{playedType}</div>
        </div>
        {hasTarget && pending.target && (
          <>
            <div className="lands-counter-arrow" aria-hidden>
              <span className="lands-counter-arrow-glyph">{arrow}</span>
              <span className="lands-counter-arrow-verb">{verb}</span>
            </div>
            <div className="lands-counter-frame">
              <LandCard card={pending.target} size="md" />
              <div className="lands-counter-card-cap">{targetCaption}</div>
            </div>
          </>
        )}
      </div>
      <p className="lands-hint">
        Counter costs an Island and a matching {playedType} from your hand.
      </p>
      {!canCounter && (
        <p className="lands-hint">You don't have both — countering isn't possible.</p>
      )}
      <div className="lands-modal-actions">
        <button className="lands-secondary" onClick={() => game.declineCounter()}>
          Don't counter
        </button>
        <button
          disabled={!canCounter}
          onClick={() => {
            const pair = options[0];
            game.counter(pair.island.id, pair.match.id);
          }}
        >
          Counter
        </button>
      </div>
    </ModalShell>
  );
}

function MountainOverlay({
  game,
  onMinimize,
}: {
  game: BoardGameApi;
  onMinimize: () => void;
}) {
  const opp = game.state!.players[game.humanSeat === 0 ? 1 : 0];
  return (
    <ModalShell
      title="Mountain — destroy one of opponent's lands"
      onMinimize={onMinimize}
    >
      <StackedCardPicker cards={opp.inPlay} onPick={(id) => game.resolveMountain(id)} />
    </ModalShell>
  );
}

/** Render a list of selectable cards, grouping identical types into
 *  overlapping stacks (same pattern as the hand and in-play areas). Each
 *  card is individually clickable; hover raises the card to the top of the
 *  stack so it remains fully visible. */
function StackedCardPicker({
  cards,
  onPick,
  size = "sm",
}: {
  cards: LandCardData[];
  onPick: (id: number) => void;
  size?: "sm" | "md";
}) {
  const overlap = size === "md" ? "-4.4rem" : "-3.2rem";
  return (
    <div className="lands-pick-row">
      {LAND_TYPES.map((t) => {
        const ofType = cards.filter((c) => c.type === t);
        if (ofType.length === 0) return null;
        return (
          <div key={t} className="lands-pick-stack">
            {ofType.map((c, i) => (
              <div
                key={c.id}
                className="lands-pick-stack-card"
                style={{ marginLeft: i === 0 ? 0 : overlap }}
              >
                <LandCard card={c} size={size} onClick={() => onPick(c.id)} />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function SwampOverlay({
  game,
  onMinimize,
}: {
  game: BoardGameApi;
  onMinimize: () => void;
}) {
  const opp = game.state!.players[game.humanSeat === 0 ? 1 : 0];
  return (
    <ModalShell
      title="Swamp — peek at opponent's hand and discard one card"
      onMinimize={onMinimize}
    >
      <StackedCardPicker cards={opp.hand} onPick={(id) => game.resolveSwamp(id)} />
    </ModalShell>
  );
}

function ForestOverlay({
  game,
  onMinimize,
}: {
  game: BoardGameApi;
  onMinimize: () => void;
}) {
  const me = game.state!.players[game.humanSeat];
  return (
    <ModalShell
      title="Forest — return a card from your discard to your hand"
      onMinimize={onMinimize}
    >
      <StackedCardPicker cards={me.discard} onPick={(id) => game.resolveForest(id)} />
    </ModalShell>
  );
}

function IslandOverlay({
  game,
  onMinimize,
}: {
  game: BoardGameApi;
  onMinimize: () => void;
}) {
  const scry = game.state!.islandScry!;
  // Selection state: each card is either "keep" (with an order) or "discard".
  const [discardSet, setDiscardSet] = useState<Set<number>>(new Set());
  const [keepOrder, setKeepOrder] = useState<number[]>(scry.revealed.map((c) => c.id));

  // Keep keepOrder in sync with discardSet when toggled.
  const toggleDiscard = (id: number) => {
    const inDiscard = discardSet.has(id);
    const nextDiscard = new Set(discardSet);
    if (inDiscard) {
      nextDiscard.delete(id);
      setKeepOrder([...keepOrder, id]);
    } else {
      nextDiscard.add(id);
      setKeepOrder(keepOrder.filter((x) => x !== id));
    }
    setDiscardSet(nextDiscard);
  };

  const move = (id: number, dir: -1 | 1) => {
    const idx = keepOrder.indexOf(id);
    if (idx < 0) return;
    const next = [...keepOrder];
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= next.length) return;
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    setKeepOrder(next);
  };

  const byId = new Map(scry.revealed.map((c) => [c.id, c]));

  return (
    <ModalShell
      title="Island — scry 4: discard any, reorder the rest on top"
      onMinimize={onMinimize}
      wide
    >
      <p className="lands-hint">First card in "Keep on top" is the one you'll draw next.</p>
      <div className="lands-scry-cols">
        <div>
          <h3>Keep on top (← first is drawn next)</h3>
          <div className="lands-pick-row">
            {keepOrder.map((id) => {
              const c = byId.get(id)!;
              return (
                <div key={id} className="lands-scry-keep">
                  <LandCard card={c} size="sm" />
                  <div className="lands-scry-controls">
                    <button onClick={() => move(id, -1)}>←</button>
                    <button onClick={() => move(id, 1)}>→</button>
                    <button onClick={() => toggleDiscard(id)}>×</button>
                  </div>
                </div>
              );
            })}
            {keepOrder.length === 0 && <div className="lands-empty-msg">(none kept)</div>}
          </div>
        </div>
        <div>
          <h3>Discard</h3>
          <div className="lands-pick-row">
            {[...discardSet].map((id) => {
              const c = byId.get(id)!;
              return (
                <div key={id} className="lands-scry-discard">
                  <LandCard card={c} size="sm" />
                  <button onClick={() => toggleDiscard(id)}>↶ keep</button>
                </div>
              );
            })}
            {discardSet.size === 0 && <div className="lands-empty-msg">(none)</div>}
          </div>
        </div>
      </div>
      <div className="lands-modal-actions">
        <button onClick={() => game.resolveIsland([...discardSet], keepOrder)}>
          Confirm
        </button>
      </div>
    </ModalShell>
  );
}

// ── Helpers ──

function countByType(cards: LandCardData[]): Record<LandType, number> {
  const out: Record<LandType, number> = {
    plains: 0,
    island: 0,
    swamp: 0,
    mountain: 0,
    forest: 0,
  };
  for (const c of cards) out[c.type]++;
  return out;
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
