import { useState, type MouseEvent } from "react";
import type { ChronicleEntry } from "./MinistrySidebar";
import { CHARACTERS } from "../data/ministrySigils";

// ─────────────────────────────────────────────────────────────
//  Hand-rolled, theme-matched charts for the Ministry Log's graphs
//  view. No charting dependency — line charts are SVG (with HTML
//  overlays for crisp text/dots), bar charts are pure HTML/CSS.
// ─────────────────────────────────────────────────────────────

export type LogMetric =
  | "winrate-cum"
  | "winrate-roll"
  | "life-diff"
  | "mission-diff"
  | "turns"
  | "winrate-mychar"
  | "winrate-oppchar";

export const LOG_METRICS: { key: LogMetric; label: string; kind: "line" | "bar" }[] = [
  { key: "winrate-cum",    label: "Win rate over time (cumulative)", kind: "line" },
  { key: "winrate-roll",   label: "Win rate over time (rolling 20)",  kind: "line" },
  { key: "life-diff",      label: "Life differential over time",      kind: "line" },
  { key: "mission-diff",   label: "Mission differential over time",   kind: "line" },
  { key: "turns",          label: "Game length (turns) over time",    kind: "line" },
  { key: "winrate-mychar", label: "Win rate by your character",       kind: "bar" },
  { key: "winrate-oppchar",label: "Win rate by opponent character",   kind: "bar" },
];

const ROLL_WINDOW = 20;

interface LinePoint { label: string; value: number; }
interface LineSeries {
  points: LinePoint[];
  yMin: number;
  yMax: number;
  unit: string;
  zeroLine: boolean; // draw a reference line at y=0 (for differentials)
}
interface BarDatum { label: string; value: number; n: number; }

function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
function sortAsc(entries: ChronicleEntry[]): ChronicleEntry[] {
  return [...entries].sort((a, b) => a.createdAt - b.createdAt);
}

function computeLine(entries: ChronicleEntry[], metric: LogMetric): LineSeries {
  const asc = sortAsc(entries);
  const label = (e: ChronicleEntry) => fmtDay(e.createdAt);

  if (metric === "winrate-cum") {
    let wins = 0;
    const points = asc.map((e, i) => {
      if (e.result === "win") wins++;
      return { label: label(e), value: (wins / (i + 1)) * 100 };
    });
    return { points, yMin: 0, yMax: 100, unit: "%", zeroLine: false };
  }
  if (metric === "winrate-roll") {
    const points = asc.map((e, i) => {
      const start = Math.max(0, i - (ROLL_WINDOW - 1));
      const win = asc.slice(start, i + 1);
      const wins = win.filter((w) => w.result === "win").length;
      return { label: label(e), value: (wins / win.length) * 100 };
    });
    return { points, yMin: 0, yMax: 100, unit: "%", zeroLine: false };
  }
  if (metric === "life-diff" || metric === "mission-diff") {
    const points = asc.map((e) => ({
      label: label(e),
      value: metric === "life-diff" ? e.myLife - e.oppLife : e.myMission - e.oppMission,
    }));
    const m = Math.max(1, ...points.map((p) => Math.abs(p.value)));
    return { points, yMin: -m, yMax: m, unit: "", zeroLine: true };
  }
  // turns
  const points = asc.map((e) => ({ label: label(e), value: e.turn }));
  const max = Math.max(1, ...points.map((p) => p.value));
  return { points, yMin: 0, yMax: max, unit: "", zeroLine: false };
}

function computeBar(entries: ChronicleEntry[], metric: LogMetric): BarDatum[] {
  const pick = metric === "winrate-mychar" ? (e: ChronicleEntry) => e.myChar : (e: ChronicleEntry) => e.oppChar;
  return CHARACTERS
    .map((c) => {
      const games = entries.filter((e) => pick(e) === c);
      const wins = games.filter((e) => e.result === "win").length;
      return { label: c, value: games.length ? (wins / games.length) * 100 : 0, n: games.length };
    })
    .filter((d) => d.n > 0);
}

// ── Chart panel — chooses line vs bar for the selected metric ──
export function LogChartPanel({ entries, metric }: { entries: ChronicleEntry[]; metric: LogMetric }) {
  const def = LOG_METRICS.find((m) => m.key === metric)!;

  if (def.kind === "bar") {
    const data = computeBar(entries, metric);
    if (data.length === 0) return <ChartEmpty />;
    return <BarChart data={data} />;
  }

  const series = computeLine(entries, metric);
  if (series.points.length < 2) return <ChartEmpty msg="Need at least two matches to plot a trend." />;
  return <LineChart series={series} />;
}

function ChartEmpty({ msg = "No matches match these filters." }: { msg?: string }) {
  return (
    <div className="mlog-chart-empty">
      <div className="flourish">· · ·</div>
      {msg}
    </div>
  );
}

// ── Line chart (SVG shapes + HTML overlay for text/dots) ──
const W = 1000, H = 360;
const PAD = { l: 58, r: 22, t: 20, b: 40 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

function LineChart({ series }: { series: LineSeries }) {
  const [hover, setHover] = useState<number | null>(null);
  const { points, yMin, yMax, unit, zeroLine } = series;
  const n = points.length;
  const span = yMax - yMin || 1;

  const xAt = (i: number) => PAD.l + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const yAt = (v: number) => PAD.t + (1 - (v - yMin) / span) * PLOT_H;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)} ${yAt(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${xAt(n - 1).toFixed(1)} ${(PAD.t + PLOT_H).toFixed(1)} L${xAt(0).toFixed(1)} ${(PAD.t + PLOT_H).toFixed(1)} Z`;

  // y ticks (5 evenly spaced) + x date labels (~6 evenly spaced).
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (span * i) / 4);
  const xTickCount = Math.min(6, n);
  const xTicks = Array.from({ length: xTickCount }, (_, i) =>
    Math.round((i / Math.max(1, xTickCount - 1)) * (n - 1)),
  );

  const fmtV = (v: number) => (unit === "%" ? `${Math.round(v)}%` : (Number.isInteger(v) ? `${v}` : v.toFixed(1)));
  const pctX = (x: number) => `${(x / W) * 100}%`;
  const pctY = (y: number) => `${(y / H) * 100}%`;

  const lastIdx = n - 1;
  const hi = hover ?? lastIdx;

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(n - 1, Math.round(fx * (n - 1)))));
  };

  return (
    <div className="mlog-linechart">
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="mlogArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((v, i) => (
          <line key={i} className="chart-grid" x1={PAD.l} y1={yAt(v)} x2={W - PAD.r} y2={yAt(v)} vectorEffect="non-scaling-stroke" />
        ))}
        {zeroLine && yMin < 0 && yMax > 0 && (
          <line className="chart-zero" x1={PAD.l} y1={yAt(0)} x2={W - PAD.r} y2={yAt(0)} vectorEffect="non-scaling-stroke" />
        )}
        <path className="chart-area" d={areaPath} fill="url(#mlogArea)" />
        <path className="chart-line" d={linePath} vectorEffect="non-scaling-stroke" />
        <line className="chart-guide" x1={xAt(hi)} y1={PAD.t} x2={xAt(hi)} y2={PAD.t + PLOT_H} vectorEffect="non-scaling-stroke" />
      </svg>

      <div className="chart-overlay">
        {yTicks.map((v, i) => (
          <span key={i} className="y-label" style={{ top: pctY(yAt(v)) }}>{fmtV(v)}</span>
        ))}
        {xTicks.map((idx) => (
          <span key={idx} className="x-label" style={{ left: pctX(xAt(idx)) }}>{points[idx].label}</span>
        ))}
        {/* current/hover marker */}
        <span className="dot" style={{ left: pctX(xAt(hi)), top: pctY(yAt(points[hi].value)) }} />
        <div
          className={`chart-tip${hi > n / 2 ? " flip" : ""}`}
          style={{ left: pctX(xAt(hi)), top: pctY(yAt(points[hi].value)) }}
        >
          <b>{fmtV(points[hi].value)}</b>
          <span>{points[hi].label}</span>
        </div>
      </div>

      <div className="chart-hit" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
    </div>
  );
}

// ── Bar chart (HTML/CSS) ──
function BarChart({ data }: { data: BarDatum[] }) {
  return (
    <div className="mlog-barchart">
      {data.map((d) => (
        <div className="bar-col" key={d.label}>
          <div className="bar-val">{Math.round(d.value)}%</div>
          <div className="bar-track">
            <div className="bar-fill" style={{ height: `${d.value}%` }} />
          </div>
          <div className="bar-label">{d.label}</div>
          <div className="bar-n">{d.n} game{d.n === 1 ? "" : "s"}</div>
        </div>
      ))}
    </div>
  );
}

// ── Recent-form sparkline (rolling win rate over the last games) ──
export function Sparkline({ entries }: { entries: ChronicleEntry[] }) {
  const asc = sortAsc(entries);
  const N = Math.min(30, asc.length);
  const recent = asc.slice(asc.length - N);
  const win = Math.min(10, N);

  if (recent.length < 2) {
    return (
      <div className="stat spark-cell">
        <div className="spark-empty">—</div>
        <span className="k">Recent Form</span>
      </div>
    );
  }

  const series = recent.map((_, i) => {
    const start = Math.max(0, i - (win - 1));
    const w = recent.slice(start, i + 1);
    return (w.filter((x) => x.result === "win").length / w.length) * 100;
  });
  const current = Math.round(series[series.length - 1]);

  const sw = 200, sh = 44;
  const xAt = (i: number) => (i / (series.length - 1)) * sw;
  const yAt = (v: number) => sh - 3 - (v / 100) * (sh - 6);
  const line = series.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(" ");
  const area = `${line} L${sw} ${sh} L0 ${sh} Z`;

  return (
    <div className="stat spark-cell">
      <div className="spark-row">
        <span className="v">{current}%</span>
        <svg className="spark-svg" viewBox={`0 0 ${sw} ${sh}`} preserveAspectRatio="none">
          <defs>
            <linearGradient id="mlogSpark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#mlogSpark)" />
          <path className="spark-line" d={line} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <span className="k">Recent Form · last {N}</span>
    </div>
  );
}
