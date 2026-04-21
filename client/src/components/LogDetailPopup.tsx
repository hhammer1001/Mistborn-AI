import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { LogEntry } from "../hooks/useGame";
import { Card } from "./Card";
import { METAL_ICONS } from "../data/metalIcons";

const METAL_NAMES = ["pewter", "tin", "bronze", "copper", "zinc", "brass", "iron", "steel", "atium"];
const ATIUM_ICON = "/cards/atium%20token.png";

function metalIconSrc(metalIndex: number): string | undefined {
  if (metalIndex === 8) return ATIUM_ICON;
  const name = METAL_NAMES[metalIndex];
  return name ? METAL_ICONS[name]?.flat : undefined;
}

interface Props {
  entry: LogEntry;
  source?: LogEntry;
  onClose: () => void;
}

function actionTag(actionType?: string): string | null {
  switch (actionType) {
    case "buy":
    case "buy_with_boxings":
    case "buy_eliminate":
    case "buy_elim_boxings":
      return "BOUGHT";
    case "burn_card":
      return "BURNED";
    case "refresh_metal":
      return "REFRESHED";
    case "use_metal":
      return "PLAYED";
    case "ally_ability_1":
    case "ally_ability_2":
      return "USED";
    case "burn_metal":
      return "BURNED";
    case "flare_metal":
      return "FLARED";
    case "sense_block":
      return "SENSED";
    case "cloud_block":
      return "CLOUDED";
    default:
      return null;
  }
}

export function LogDetailPopup({ entry, source, onClose }: Props) {
  // Click anywhere or press Esc to close
  useEffect(() => {
    const handle = () => onClose();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const t = setTimeout(() => {
      window.addEventListener("click", handle, true);
      window.addEventListener("contextmenu", handle, true);
      window.addEventListener("keydown", key);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", handle, true);
      window.removeEventListener("contextmenu", handle, true);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  const tag = actionTag(entry.actionType);

  // Build body based on what the entry carries
  let body: React.ReactNode = null;

  // Combined view: source (burn/flare/burn_card) → target (use_metal card)
  if (source && entry.card) {
    const arrowKind = source.actionType === "flare_metal" ? "flare" : "burn";
    const sourceVerb = source.actionType === "flare_metal"
      ? "FLARE"
      : source.actionType === "burn_card"
      ? "BURN"
      : "BURN";
    let sourceNode: React.ReactNode = null;
    if (source.actionType === "burn_card" && source.card) {
      sourceNode = (
        <div className="log-popup-source source-card">
          <div className="log-popup-tag">{sourceVerb}</div>
          <Card card={source.card} baseWidth={180} noTypeBorder />
        </div>
      );
    } else if (source.metalIndex !== undefined && metalIconSrc(source.metalIndex)) {
      sourceNode = (
        <div className="log-popup-source source-metal">
          <div className="log-popup-tag">{sourceVerb}</div>
          <img className="log-popup-metal-icon-large" src={metalIconSrc(source.metalIndex)} alt="" draggable={false} />
          <div className="log-popup-metal-name">{METAL_NAMES[source.metalIndex]}</div>
        </div>
      );
    }

    body = (
      <div className="log-popup-composite">
        {sourceNode}
        <div className={`log-popup-arrow arrow-${arrowKind}`}>
          <svg viewBox="0 0 64 24" width="72" height="28" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="12" x2="54" y2="12" />
            <polyline points="44,4 58,12 44,20" />
          </svg>
        </div>
        <div className="log-popup-target">
          <div className="log-popup-tag">PLAYED</div>
          <Card card={entry.card} baseWidth={220} noTypeBorder />
        </div>
      </div>
    );
  } else if (entry.recap) {
    const r = entry.recap;
    const lines: { label: string; cls: string }[] = [];
    if (r.mission) lines.push({ label: `${r.mission} mission`, cls: "mission" });
    if (r.damageToPlayer) lines.push({ label: `${r.damageToPlayer.amount} damage to ${r.damageToPlayer.name}`, cls: "damage" });
    for (const a of r.damageToAllies ?? []) {
      lines.push({ label: `${a.amount} damage to ${a.name}`, cls: "damage" });
    }
    if (r.trained) lines.push({ label: `${r.trained} trained`, cls: "train" });
    if (r.healed) lines.push({ label: `${r.healed} heal`, cls: "heal" });
    const boughtParts: string[] = [...(r.boughtCards ?? [])];
    if (r.boxingsGained) boughtParts.push(`${r.boxingsGained} Boxing${r.boxingsGained > 1 ? "s" : ""}`);
    if (boughtParts.length) lines.push({ label: `Bought ${boughtParts.join(", ")}`, cls: "bought" });
    body = (
      <div className="log-popup-recap">
        <div className="log-popup-recap-title">Turn recap</div>
        <div className="log-popup-recap-lines">
          {lines.map((l, i) => <div key={i} className={`log-popup-recap-line ${l.cls}`}>{l.label}</div>)}
        </div>
      </div>
    );
  } else if (entry.card) {
    body = (
      <div className="log-popup-card-wrap">
        {tag && <div className="log-popup-tag">{tag}</div>}
        <Card card={entry.card} baseWidth={260} noTypeBorder />
        {entry.metalIndex !== undefined && metalIconSrc(entry.metalIndex) && (
          <div className="log-popup-metal-row">
            <img className="log-popup-metal-icon" src={metalIconSrc(entry.metalIndex)} alt="" draggable={false} />
            <span className="log-popup-metal-name">{METAL_NAMES[entry.metalIndex]}</span>
          </div>
        )}
      </div>
    );
  } else if (entry.metalIndex !== undefined && metalIconSrc(entry.metalIndex)) {
    body = (
      <div className="log-popup-metal-wrap">
        {tag && <div className="log-popup-tag">{tag}</div>}
        <img className="log-popup-metal-icon-large" src={metalIconSrc(entry.metalIndex)} alt="" draggable={false} />
        <div className="log-popup-metal-name">{METAL_NAMES[entry.metalIndex]}</div>
      </div>
    );
  } else {
    body = <div className="log-popup-text">{entry.text}</div>;
  }

  return createPortal(
    <div className="log-popup-overlay">
      <div className="log-popup-panel">
        {body}
      </div>
    </div>,
    document.body,
  );
}
