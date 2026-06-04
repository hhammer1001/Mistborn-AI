import { useState, useMemo, useRef, useEffect } from "react";
import {
  CHARACTERS,
  BOT_TYPES,
  BOT_TYPE_LABELS,
  VICTORY_TYPES,
  botLabel,
  type VictoryType,
} from "../data/ministrySigils";
import type { ChronicleEntry } from "./MinistrySidebar";
import {
  LOG_FILTER_KEYS,
  type LogFilterKey,
} from "../hooks/useMinistryPrefs";

// Cards worth calling out in the deck breakdown (the high-impact ones).
const KEY_CARDS = new Set([
  "House War", "Crushing Blow", "Maelstrom", "Assassinate", "Confrontation", "Dominate",
]);

const FILTER_LABELS: Record<LogFilterKey, string> = {
  result: "Result",
  mode: "Mode",
  first: "First Player",
  date: "Date Range",
  bot: "Bot Strategy",
  vic: "Victory Type",
  char: "Your Character",
  oppChar: "Opp Character",
  search: "Search",
};

type ResultFilter = "all" | "win" | "loss";
type ModeFilter = "all" | "bot" | "mp";
type FirstFilter = "all" | "me" | "opp";
type SearchScope = "both" | "mine" | "opp";
type SortKey = "date" | "first" | "victory" | "turn" | "deck";

interface Selections {
  result: ResultFilter;
  mode: ModeFilter;
  first: FirstFilter;
  dateFrom: string; // "YYYY-MM-DD" (empty = open-ended)
  dateTo: string;   // "YYYY-MM-DD" (empty = open-ended)
  bot: string;     // BotType | "all"
  vic: string;     // VictoryType | "all"
  char: string;    // your character | "all"
  oppChar: string; // opponent character | "all"
  search: string;
  searchScope: SearchScope; // which deck the card-name search looks at
}

const DEFAULT_SELECTIONS: Selections = {
  result: "all", mode: "all", first: "all",
  dateFrom: "", dateTo: "",
  bot: "all", vic: "all", char: "all", oppChar: "all", search: "", searchScope: "both",
};

// Reset patch applied when a filter is hidden, so it stops affecting results.
function resetPatch(key: LogFilterKey): Partial<Selections> {
  if (key === "date") return { dateFrom: "", dateTo: "" };
  if (key === "search") return { search: "" };
  return { [key]: "all" } as Partial<Selections>;
}

const VIC_ORDER: Record<VictoryType, number> = {
  Mission: 0, Combat: 1, Confrontation: 2, Forfeit: 3,
};

function deckSize(deck: Record<string, number>): number {
  return Object.values(deck).reduce((a, b) => a + b, 0);
}

function fmtDate(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
}

interface Props {
  entries: ChronicleEntry[];
  onBack: () => void;
  onSelectMatch?: (matchId: string) => void;
  visibleFilters: LogFilterKey[];
  onChangeVisibleFilters: (keys: LogFilterKey[]) => void;
}

export function MinistryLog({
  entries,
  onBack,
  onSelectMatch,
  visibleFilters,
  onChangeVisibleFilters,
}: Props) {
  const [sel, setSel] = useState<Selections>(DEFAULT_SELECTIONS);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const customizeRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => new Set(visibleFilters), [visibleFilters]);

  // Close the customize popover on an outside click.
  useEffect(() => {
    if (!customizeOpen) return;
    const onDown = (e: MouseEvent) => {
      if (customizeRef.current && !customizeRef.current.contains(e.target as Node)) {
        setCustomizeOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [customizeOpen]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (visible.has("result") && sel.result !== "all" && e.result !== sel.result) return false;
      if (visible.has("mode") && sel.mode !== "all" && e.kind !== sel.mode) return false;
      if (visible.has("first") && sel.first !== "all" && e.firstPlayer !== sel.first) return false;
      if (visible.has("date")) {
        if (sel.dateFrom && e.createdAt < new Date(sel.dateFrom + "T00:00:00").getTime()) return false;
        if (sel.dateTo && e.createdAt > new Date(sel.dateTo + "T23:59:59.999").getTime()) return false;
      }
      if (visible.has("bot") && sel.bot !== "all" && e.botType !== sel.bot) return false;
      if (visible.has("vic") && sel.vic !== "all" && e.victory !== sel.vic) return false;
      if (visible.has("char") && sel.char !== "all" && e.myChar !== sel.char) return false;
      if (visible.has("oppChar") && sel.oppChar !== "all" && e.oppChar !== sel.oppChar) return false;
      if (visible.has("search") && sel.search) {
        const q = sel.search.toLowerCase();
        const inOpp = e.opp.toLowerCase().includes(q);
        const inChar = (e.myChar + e.oppChar).toLowerCase().includes(q);
        const myCards = Object.keys(e.myDeck).some((c) => c.toLowerCase().includes(q));
        const oppCards = Object.keys(e.oppDeck).some((c) => c.toLowerCase().includes(q));
        const inCards =
          sel.searchScope === "mine" ? myCards :
          sel.searchScope === "opp" ? oppCards :
          myCards || oppCards;
        if (!inOpp && !inChar && !inCards) return false;
      }
      return true;
    });
  }, [entries, sel, visible]);

  const sorted = useMemo(() => {
    const rows = filtered.slice();
    rows.sort((a, b) => {
      let av: number | string, bv: number | string;
      if (sortKey === "victory") { av = VIC_ORDER[a.victory]; bv = VIC_ORDER[b.victory]; }
      else if (sortKey === "first") { av = a.firstPlayer; bv = b.firstPlayer; }
      else if (sortKey === "deck") { av = deckSize(a.myDeck); bv = deckSize(b.myDeck); }
      else if (sortKey === "date") { av = a.createdAt; bv = b.createdAt; }
      else { av = a.turn; bv = b.turn; }
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
    return rows;
  }, [filtered, sortKey, sortDir]);

  // Summary stats reflect the filtered set.
  const stats = useMemo(() => {
    const total = filtered.length;
    const wins = filtered.filter((e) => e.result === "win").length;
    const losses = total - wins;
    const wr = total ? Math.round((wins / total) * 100) : 0;
    const avgTurns = total ? (filtered.reduce((a, e) => a + e.turn, 0) / total).toFixed(1) : "—";
    const missionWins = filtered.filter((e) => e.result === "win" && e.victory === "Mission").length;
    const combatWins = filtered.filter((e) => e.result === "win" && e.victory === "Combat").length;
    return { total, wins, losses, wr, avgTurns, missionWins, combatWins };
  }, [filtered]);

  const sortBy = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(key === "date" || key === "turn" || key === "deck" ? -1 : 1);
    }
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const updateSel = (patch: Partial<Selections>) => setSel((s) => ({ ...s, ...patch }));

  const toggleVisible = (key: LogFilterKey) => {
    if (visible.has(key)) {
      onChangeVisibleFilters(visibleFilters.filter((k) => k !== key));
      // Reset the now-hidden filter so it stops affecting results.
      updateSel(resetPatch(key));
    } else {
      // Preserve the canonical filter order when re-adding.
      onChangeVisibleFilters(LOG_FILTER_KEYS.filter((k) => k === key || visible.has(k)));
    }
  };

  const clearFilters = () => setSel(DEFAULT_SELECTIONS);

  const sortArrow = (key: SortKey) =>
    sortKey === key ? <span className="arrow">{sortDir === 1 ? "▲" : "▼"}</span> : null;

  return (
    <div className="mlog">
      <div className="mlog-hdr">
        <div className="titles">
          <span className="eyebrow">Steel Ministry</span>
          <h1>Full Records</h1>
          <span className="sub">· complete chronicle of filed matches ·</span>
        </div>
        <button className="mlog-back" onClick={onBack}>← Back to Menu</button>
      </div>

      <div className="mlog-stats">
        <div className="stat"><span className="v dim">{stats.total}</span><span className="k">Matches</span></div>
        <div className="stat"><span className="v">{stats.wins}<span className="unit">W</span></span><span className="k">Won</span></div>
        <div className="stat"><span className="v loss">{stats.losses}<span className="unit">L</span></span><span className="k">Lost</span></div>
        <div className="stat"><span className="v">{stats.wr}%</span><span className="k">Win Rate</span></div>
        <div className="stat"><span className="v dim">{stats.avgTurns}</span><span className="k">Avg Turns</span></div>
        <div className="stat"><span className="v dim">{stats.missionWins}<span className="unit"> · {stats.combatWins} dmg</span></span><span className="k">Mission Wins</span></div>
      </div>

      <div className="mlog-filters">
        <div className="fgroup" ref={customizeRef}>
          <label>&nbsp;</label>
          <div className="customize">
            <button
              className="customize-btn"
              aria-haspopup="true"
              aria-expanded={customizeOpen}
              onClick={() => setCustomizeOpen((o) => !o)}
            >
              ⚙ Filters <span className="caret">▾</span>
            </button>
            {customizeOpen && (
              <div className="customize-pop">
                <div className="customize-pop-head">Show filters</div>
                <div className="customize-list">
                  {LOG_FILTER_KEYS.map((key) => (
                    <label className="customize-item" key={key}>
                      <input
                        type="checkbox"
                        checked={visible.has(key)}
                        onChange={() => toggleVisible(key)}
                      />
                      {FILTER_LABELS[key]}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {visible.has("result") && (
          <div className="fgroup">
            <label>Result</label>
            <Seg
              value={sel.result}
              options={[["all", "All"], ["win", "Wins"], ["loss", "Losses"]]}
              onChange={(v) => updateSel({ result: v as ResultFilter })}
            />
          </div>
        )}
        {visible.has("mode") && (
          <div className="fgroup">
            <label>Mode</label>
            <Seg
              value={sel.mode}
              options={[["all", "All"], ["bot", "Bot"], ["mp", "Online"]]}
              onChange={(v) => updateSel({ mode: v as ModeFilter })}
            />
          </div>
        )}
        {visible.has("first") && (
          <div className="fgroup">
            <label>First Player</label>
            <Seg
              value={sel.first}
              options={[["all", "All"], ["me", "You"], ["opp", "Opp"]]}
              onChange={(v) => updateSel({ first: v as FirstFilter })}
            />
          </div>
        )}
        {visible.has("date") && (
          <div className="fgroup">
            <label>Date Range</label>
            <div className="mlog-daterange">
              <input
                type="date"
                aria-label="From date"
                value={sel.dateFrom}
                max={sel.dateTo || undefined}
                onChange={(e) => updateSel({ dateFrom: e.target.value })}
              />
              <span className="dash">–</span>
              <input
                type="date"
                aria-label="To date"
                value={sel.dateTo}
                min={sel.dateFrom || undefined}
                onChange={(e) => updateSel({ dateTo: e.target.value })}
              />
            </div>
          </div>
        )}
        {visible.has("bot") && (
          <div className="fgroup">
            <label>Bot Strategy</label>
            <select value={sel.bot} onChange={(e) => updateSel({ bot: e.target.value })}>
              <option value="all">All bots</option>
              {BOT_TYPES.map((b) => <option key={b} value={b}>{BOT_TYPE_LABELS[b]}</option>)}
            </select>
          </div>
        )}
        {visible.has("vic") && (
          <div className="fgroup">
            <label>Victory Type</label>
            <select value={sel.vic} onChange={(e) => updateSel({ vic: e.target.value })}>
              <option value="all">All</option>
              {VICTORY_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        )}
        {visible.has("char") && (
          <div className="fgroup">
            <label>Your Character</label>
            <select value={sel.char} onChange={(e) => updateSel({ char: e.target.value })}>
              <option value="all">All</option>
              {CHARACTERS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        {visible.has("oppChar") && (
          <div className="fgroup">
            <label>Opp Character</label>
            <select value={sel.oppChar} onChange={(e) => updateSel({ oppChar: e.target.value })}>
              <option value="all">All</option>
              {CHARACTERS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        {visible.has("search") && (
          <div className="search">
            <label>Search (opponent / card)</label>
            <input
              type="text"
              placeholder="e.g. Maelstrom, Hammer Bot…"
              value={sel.search}
              onChange={(e) => updateSel({ search: e.target.value })}
            />
            <div className="search-scope">
              <span className="scope-label">cards:</span>
              <Seg
                value={sel.searchScope}
                options={[["both", "Both"], ["mine", "Yours"], ["opp", "Opp"]]}
                onChange={(v) => updateSel({ searchScope: v as SearchScope })}
              />
            </div>
          </div>
        )}
        <button className="mlog-clear" onClick={clearFilters}>clear filters</button>
      </div>

      <div className="mlog-table-wrap">
        <table>
          <thead>
            <tr>
              <th className="center">✦</th>
              <th className="sortable" onClick={() => sortBy("date")}>Date {sortArrow("date")}</th>
              <th>Matchup</th>
              <th>Mode</th>
              <th className="sortable" onClick={() => sortBy("first")}>First {sortArrow("first")}</th>
              <th className="sortable" onClick={() => sortBy("victory")}>Victory {sortArrow("victory")}</th>
              <th className="sortable num" onClick={() => sortBy("turn")}>Turns {sortArrow("turn")}</th>
              <th className="center">Life (you/opp)</th>
              <th className="center">Mission (you/opp)</th>
              <th className="sortable num" onClick={() => sortBy("deck")}>Cards Used {sortArrow("deck")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={10}>
                  <div className="mlog-empty"><div className="flourish">· · ·</div>No matches match these filters.</div>
                </td>
              </tr>
            ) : (
              sorted.map((e) => (
                <LogRow
                  key={e.id}
                  entry={e}
                  expanded={expanded.has(e.id)}
                  onToggle={() => toggleExpanded(e.id)}
                  onOpen={onSelectMatch}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mlog-footcount">Showing {sorted.length} of {entries.length} filed matches</div>
    </div>
  );
}

// ── Segmented control ──
function Seg({
  value, options, onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="seg">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? "on" : ""} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  );
}

// ── Deck chips for the expanded breakdown ──
function deckChips(deck: Record<string, number>) {
  return Object.entries(deck)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => (
      <span className={`chip${KEY_CARDS.has(name) ? " key" : ""}`} key={name}>
        <span className="n">{n}×</span>{name}
      </span>
    ));
}

// ── One match row (+ optional expanded deck detail) ──
function LogRow({
  entry: e, expanded, onToggle, onOpen,
}: {
  entry: ChronicleEntry;
  expanded: boolean;
  onToggle: () => void;
  onOpen?: (id: string) => void;
}) {
  const firstLabel = e.firstPlayer === "me" ? "You" : "Opp";
  const modeLabel = e.kind === "bot" ? "Bot" : "Online";
  const size = deckSize(e.myDeck);

  return (
    <>
      <tr className={`row ${e.result}${expanded ? " expanded" : ""}`} onClick={onToggle}>
        <td className="center"><span className={`glyph ${e.result}`}>{e.result === "win" ? "✦" : "✧"}</span></td>
        <td>{fmtDate(e.createdAt)}</td>
        <td className="matchup">
          <span className="you">You</span> <span className="char">({e.myChar})</span>
          <span className="vs">vs</span>
          {e.opp} <span className="char">({e.oppChar})</span>
        </td>
        <td>
          <span className={`mode-pill ${e.kind}`}>{modeLabel}</span>
          {e.kind === "bot" && e.botType && <span className="strat"> {botLabel(e.botType)}</span>}
        </td>
        <td>{firstLabel}</td>
        <td><span className={`vic ${e.victory}`}>{e.victory}</span></td>
        <td className="num">{e.turn}</td>
        <td className="center pair"><b>{e.myLife}</b><span className="slash">/</span><span className="lo">{e.oppLife}</span></td>
        <td className="center pair"><b>{e.myMission}</b><span className="slash">/</span><span className="lo">{e.oppMission}</span></td>
        <td className="num">
          <div className="cards-cell">
            <span className="cards-count">{size}</span>
            <span className="chev">▶</span>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="detail">
          <td colSpan={10}>
            <div className="detail-inner">
              <div className="deck-col">
                <h4>Your deck <span className="who">You · {e.myChar}</span></h4>
                <div className="chips">{deckChips(e.myDeck)}</div>
              </div>
              <div className="deck-col">
                <h4>Opponent deck <span className="who">{e.opp} · {e.oppChar}</span></h4>
                <div className="chips">{deckChips(e.oppDeck)}</div>
              </div>
              <div className="meta-line">
                <span><b>Result:</b> {e.result === "win" ? "Victory" : "Defeat"} by {e.victory}</span>
                <span><b>Turns:</b> {e.turn}</span>
                <span><b>First player:</b> {firstLabel}</span>
                <span><b>Final life:</b> you {e.myLife} · opp {e.oppLife}</span>
                <span><b>Mission tier:</b> you {e.myMission} · opp {e.oppMission}</span>
                {onOpen && (
                  <button
                    className="mlog-open-review"
                    onClick={(ev) => { ev.stopPropagation(); onOpen(e.id); }}
                  >
                    Open full review →
                  </button>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
