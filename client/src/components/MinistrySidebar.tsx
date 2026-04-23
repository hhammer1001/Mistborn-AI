import { useMemo } from "react";
import {
  MINISTRY_METALS,
  MINISTRY_SYMBOL_SRC,
  type BotType,
  type VictoryType,
} from "../data/ministrySigils";
import type { LogFilter } from "../hooks/useMinistryPrefs";

export interface ChronicleEntry {
  id: string;
  date: string;
  opp: string;
  kind: "mp" | "bot";
  botType?: BotType;
  result: "win" | "loss";
  victory: VictoryType;
  turn: number;
  firstPlayer: "me" | "opp";
  myChar: string;
  oppChar: string;
  myLife: number;
  oppLife: number;
  myMission: number;
  oppMission: number;
}

interface Props {
  // Identity
  isAuthed: boolean;
  displayName: string | null;
  createdAt?: number | null;
  // Sigil state
  sigil: string;
  flared: boolean;
  onOpenSigilPicker: () => void;
  // Chronicle data + filter
  entries: ChronicleEntry[];
  filter: LogFilter;
  // Actions
  onOpenAuth: () => void;
  onSignOut: () => void;
  onOpenFeedback: () => void;
  onOpenSettings: (anchorId: string) => void;
}

function toRoman(n: number): string {
  const m: [string, number][] = [
    ["M", 1000], ["CM", 900], ["D", 500], ["CD", 400],
    ["C", 100], ["XC", 90], ["L", 50], ["XL", 40],
    ["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1],
  ];
  let out = "";
  for (const [r, v] of m) while (n >= v) { out += r; n -= v; }
  return out;
}

function sigilSrc(sigilKey: string, flared: boolean): { src: string; label: string } {
  const m = MINISTRY_METALS.find((x) => x.key === sigilKey) ?? MINISTRY_METALS.find((x) => x.key === "steel")!;
  return { src: flared ? m.ringed : m.flat, label: m.label };
}

function filterEntries(all: ChronicleEntry[], f: LogFilter): ChronicleEntry[] {
  return all.filter((e) => {
    if (f.mode === "bot"   && e.kind !== "bot") return false;
    if (f.mode === "human" && e.kind !== "mp")  return false;
    if (e.kind === "bot" && e.botType && !f.bots.includes(e.botType)) return false;
    if (!f.victories.includes(e.victory)) return false;
    return true;
  });
}

export function MinistrySidebar({
  isAuthed,
  displayName,
  createdAt,
  sigil,
  flared,
  onOpenSigilPicker,
  entries,
  filter,
  onOpenAuth,
  onSignOut,
  onOpenFeedback,
  onOpenSettings,
}: Props) {
  const { src: sigilImgSrc, label: sigilLabel } = sigilSrc(sigil, flared);

  const filtered = useMemo(() => filterEntries(entries, filter), [entries, filter]);
  const wins   = filtered.filter((e) => e.result === "win").length;
  const losses = filtered.filter((e) => e.result === "loss").length;
  const countLabel = filtered.length === 0 ? "—" : `${toRoman(filtered.length)} filed`;

  const createdLabel = createdAt
    ? `on record · since ${new Date(createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}`
    : "on record";

  const isAtiumFlat = sigil === "atium" && !flared;

  return (
    <aside className="ms-sidebar">
      <div className="ms-sidebar-title">
        <div className="name-block">
          Steel Ministry
          <span className="main">RECORDS</span>
        </div>
        <span
          className="stamp"
          aria-label="Steel Ministry"
          style={{ backgroundImage: `url(${MINISTRY_SYMBOL_SRC})` }}
        />
      </div>

      {isAuthed ? (
        <div className="ms-identity">
          <div className="ms-medallion-wrap">
            <div
              className="ms-medallion"
              data-metal={sigil}
              data-flared={String(flared)}
              data-atium-flat={isAtiumFlat ? "true" : "false"}
              onClick={onOpenSigilPicker}
              title="Click to change your sigil"
            >
              <img className="sigil" src={sigilImgSrc} alt={sigilLabel} />
              <span className="edit-hint">✎</span>
            </div>
            <span className="ms-tally ms-tally-w">{wins} W</span>
            <span className="ms-tally ms-tally-l">{losses} L</span>
          </div>
          <div className="ms-identity-name">{displayName ?? "—"}</div>
          <div className="ms-identity-house">{createdLabel}</div>
        </div>
      ) : (
        <div className="ms-identity is-guest">
          <div className="ms-medallion-wrap" style={{ height: "104px" }}>
            <div className="ms-medallion">
              <div
                className="wax"
                aria-label="Steel Ministry"
                style={{ backgroundImage: `url(${MINISTRY_SYMBOL_SRC})` }}
              />
            </div>
          </div>
          <div className="ms-identity-name">No File on Record</div>
          <div className="ms-identity-house">Open a file to play ranked matches</div>
        </div>
      )}

      <div className="ms-section-head">
        <span>Match Records</span>
        <span className="count">{countLabel}</span>
      </div>

      <div className="ms-scroll">
        {filtered.length === 0 ? (
          <div className="ms-empty">
            <div className="flourish">· · ·</div>
            {isAuthed
              ? <>No matches on file.<br/>Play your first match to open your record.</>
              : <>Your file is not yet open.<br/>Register with the Ministry to keep<br/>a permanent record of your matches.</>}
          </div>
        ) : (
          filtered.map((e) => <ChronicleRow key={e.id} entry={e} />)
        )}
      </div>

      <div className="ms-util">
        {isAuthed ? (
          <>
            <button onClick={onOpenFeedback}>
              <span className="dot" /> Leave Feedback
            </button>
            <button id="ms-settings-btn" onClick={() => onOpenSettings("ms-settings-btn")}>
              <span className="dot" /> Settings
            </button>
            <button onClick={onSignOut}>
              <span className="dot" /> Close File (Log Out)
            </button>
          </>
        ) : (
          <>
            <button className="primary" onClick={onOpenAuth}>Open a File (Login)</button>
            <button onClick={onOpenFeedback}>
              <span className="dot" /> Leave Feedback
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

function ChronicleRow({ entry: e }: { entry: ChronicleEntry }) {
  const me  = <>You <span className="char">({e.myChar})</span></>;
  const opp = <>{e.opp} <span className="char">({e.oppChar})</span></>;
  const firstEl  = <b>{e.firstPlayer === "me" ? me : opp}</b>;
  const secondEl = e.firstPlayer === "me" ? opp : me;

  const first = e.firstPlayer === "me"
    ? { life: e.myLife,  mission: e.myMission }
    : { life: e.oppLife, mission: e.oppMission };
  const second = e.firstPlayer === "me"
    ? { life: e.oppLife, mission: e.oppMission }
    : { life: e.myLife,  mission: e.myMission };

  const mode = e.kind === "mp" ? "Online" : "Bot";
  const glyph = e.result === "win" ? "✦" : "✧";

  return (
    <div className={`ms-entry ${e.result}`}>
      <div className="glyph">{glyph}</div>
      <div className="row-top">
        <div className="players">
          {firstEl} <span className="sep">vs</span> {secondEl}
        </div>
      </div>
      <div className="row-bottom">
        <div className="meta">{e.date} · {mode} · {e.victory} · T{e.turn}</div>
        <div className="aux-inline">
          <span className="totals">
            L <b>{first.life}</b><span className="slash">/</span>{second.life}
            <span className="dot">·</span>
            M <b>{first.mission}</b><span className="slash">/</span>{second.mission}
          </span>
        </div>
      </div>
    </div>
  );
}
