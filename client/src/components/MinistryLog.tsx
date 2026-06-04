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
import { LogChartPanel, Sparkline, LOG_METRICS, type LogMetric } from "./LogCharts";

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

type SearchScope = "both" | "mine" | "opp";
type SortKey = "date" | "first" | "victory" | "turn" | "deck";

// Categorical filters are multi-select: an empty array means "no constraint"
// (show all); any subset narrows to those values.
interface Selections {
  result: string[];  // subset of "win" | "loss"
  mode: string[];    // subset of "bot" | "mp"
  first: string[];   // subset of "me" | "opp"
  dateFrom: string;  // "YYYY-MM-DD" (empty = open-ended)
  dateTo: string;    // "YYYY-MM-DD" (empty = open-ended)
  bot: string[];     // BotType[]
  vic: string[];     // VictoryType[]
  char: string[];    // your characters
  oppChar: string[]; // opponent characters
  search: string;
  searchScope: SearchScope; // which deck the card-name search looks at
}

const DEFAULT_SELECTIONS: Selections = {
  result: [], mode: [], first: [],
  dateFrom: "", dateTo: "",
  bot: [], vic: [], char: [], oppChar: [], search: "", searchScope: "both",
};

// Reset patch applied when a filter is hidden, so it stops affecting results.
function resetPatch(key: LogFilterKey): Partial<Selections> {
  if (key === "date") return { dateFrom: "", dateTo: "" };
  if (key === "search") return { search: "" };
  return { [key]: [] } as Partial<Selections>;
}

// Empty selection = no constraint; otherwise the value must be in the set.
const inSet = (arr: string[], val: string | undefined) => arr.length === 0 || (val != null && arr.includes(val));

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
  const [viewMode, setViewMode] = useState<"table" | "graphs">("table");
  const [chartMetric, setChartMetric] = useState<LogMetric>("winrate-cum");
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
      if (visible.has("result") && !inSet(sel.result, e.result)) return false;
      if (visible.has("mode") && !inSet(sel.mode, e.kind)) return false;
      if (visible.has("first") && !inSet(sel.first, e.firstPlayer)) return false;
      if (visible.has("date")) {
        if (sel.dateFrom && e.createdAt < new Date(sel.dateFrom + "T00:00:00").getTime()) return false;
        if (sel.dateTo && e.createdAt > new Date(sel.dateTo + "T23:59:59.999").getTime()) return false;
      }
      if (visible.has("bot") && !inSet(sel.bot, e.botType)) return false;
      if (visible.has("vic") && !inSet(sel.vic, e.victory)) return false;
      if (visible.has("char") && !inSet(sel.char, e.myChar)) return false;
      if (visible.has("oppChar") && !inSet(sel.oppChar, e.oppChar)) return false;
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
        <div className="mlog-hdr-actions">
          <Seg
            value={viewMode}
            options={[["table", "Table"], ["graphs", "Graphs"]]}
            onChange={(v) => setViewMode(v as "table" | "graphs")}
          />
          <button className="mlog-back" onClick={onBack}>← Back to Menu</button>
        </div>
      </div>

      <div className="mlog-stats">
        <div className="stat"><span className="v dim">{stats.total}</span><span className="k">Matches</span></div>
        <div className="stat"><span className="v">{stats.wins}<span className="unit">W</span></span><span className="k">Won</span></div>
        <div className="stat"><span className="v loss">{stats.losses}<span className="unit">L</span></span><span className="k">Lost</span></div>
        <div className="stat highlight"><span className="v">{stats.wr}%</span><span className="k">Win Rate</span></div>
        <div className="stat"><span className="v dim">{stats.avgTurns}</span><span className="k">Avg Turns</span></div>
        <div className="stat"><span className="v dim">{stats.missionWins}<span className="unit"> · {stats.combatWins} dmg</span></span><span className="k">Mission Wins</span></div>
        <Sparkline entries={filtered} />
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
            <MultiSelect
              options={[{ value: "win", label: "Wins" }, { value: "loss", label: "Losses" }]}
              selected={sel.result}
              onChange={(v) => updateSel({ result: v })}
            />
          </div>
        )}
        {visible.has("mode") && (
          <div className="fgroup">
            <label>Mode</label>
            <MultiSelect
              options={[{ value: "bot", label: "Bot" }, { value: "mp", label: "Online" }]}
              selected={sel.mode}
              onChange={(v) => updateSel({ mode: v })}
            />
          </div>
        )}
        {visible.has("first") && (
          <div className="fgroup">
            <label>First Player</label>
            <MultiSelect
              options={[{ value: "me", label: "You" }, { value: "opp", label: "Opp" }]}
              selected={sel.first}
              onChange={(v) => updateSel({ first: v })}
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
            <MultiSelect
              options={BOT_TYPES.map((b) => ({ value: b, label: BOT_TYPE_LABELS[b] }))}
              selected={sel.bot}
              onChange={(v) => updateSel({ bot: v })}
              allLabel="All bots"
            />
          </div>
        )}
        {visible.has("vic") && (
          <div className="fgroup">
            <label>Victory Type</label>
            <MultiSelect
              options={VICTORY_TYPES.map((v) => ({ value: v, label: v }))}
              selected={sel.vic}
              onChange={(v) => updateSel({ vic: v })}
            />
          </div>
        )}
        {visible.has("char") && (
          <div className="fgroup">
            <label>Your Character</label>
            <MultiSelect
              options={CHARACTERS.map((c) => ({ value: c, label: c }))}
              selected={sel.char}
              onChange={(v) => updateSel({ char: v })}
            />
          </div>
        )}
        {visible.has("oppChar") && (
          <div className="fgroup">
            <label>Opp Character</label>
            <MultiSelect
              options={CHARACTERS.map((c) => ({ value: c, label: c }))}
              selected={sel.oppChar}
              onChange={(v) => updateSel({ oppChar: v })}
            />
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

      {viewMode === "graphs" ? (
        <div className="mlog-chart-wrap">
          <div className="mlog-chart-toolbar">
            <label>Metric</label>
            <select value={chartMetric} onChange={(e) => setChartMetric(e.target.value as LogMetric)}>
              {LOG_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
          <LogChartPanel entries={filtered} metric={chartMetric} />
        </div>
      ) : (
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
      )}
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

// ── Multi-select checkbox dropdown ──
// Empty selection = no constraint (shows allLabel). Any subset narrows.
function MultiSelect({
  options, selected, onChange, allLabel = "All",
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  const summary =
    selected.length === 0 ? allLabel :
    selected.length === 1 ? (options.find((o) => o.value === selected[0])?.label ?? selected[0]) :
    `${selected.length} selected`;

  return (
    <div className={`ms-multi${open ? " open" : ""}`} ref={ref}>
      <button type="button" className="ms-multi-btn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`ms-multi-summary${selected.length === 0 ? " all" : ""}`}>{summary}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="ms-multi-pop">
          <div className="ms-multi-actions">
            <button type="button" onClick={() => onChange(options.map((o) => o.value))}>Select all</button>
            <span className="sep">·</span>
            <button type="button" onClick={() => onChange([])}>None</button>
          </div>
          {options.map((o) => (
            <label className="customize-item" key={o.value}>
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      )}
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
