import type { GameAction, PlayerData } from "../types/game";

const METAL_NAMES = ["pewter", "tin", "bronze", "copper", "zinc", "brass", "iron", "steel", "atium"];

interface Props {
  actions: GameAction[];
  onAction: (index: number) => void;
  missionRemaining: number;
  player: PlayerData;
}

function getReminders(player: PlayerData, actions: GameAction[]): string[] {
  const reminders: string[] = [];
  const burnCount = player.metalTokens.slice(0, 8).filter((t) => t === 1).length + player.metalTokens[8];
  const hasBurnsLeft = burnCount < player.burns;
  if (!hasBurnsLeft) return reminders;

  // Helper: can we burn (not flare) a specific metal?
  const canBurnMetal = (metal: number) =>
    player.metalTokens[metal] === 0 && actions.some((a) => a.code === 5 && a.metalIndex === metal);

  // Check character ability 1
  if (player.charAbility1 && player.training >= 5) {
    const metal = parseInt(player.ability1metal);
    const isAvailable = actions.some((a) => a.code === 10);
    if (isAvailable) {
      reminders.push("Character Ability I available");
    } else if (player.metalBurned[metal] === 0 && canBurnMetal(metal)) {
      reminders.push(`Character Ability I (burn ${METAL_NAMES[metal]})`);
    }
  }

  // Check character ability 3
  if (player.charAbility3 && player.training >= 13) {
    const isAvailable = actions.some((a) => a.code === 11);
    if (isAvailable) {
      reminders.push("Character Ability III available");
    } else if (player.metalBurned[8] === 0 && player.atium > 0 && canBurnMetal(8)) {
      reminders.push("Character Ability III (burn atium)");
    }
  }

  // Check ally abilities that could be unlocked with a burn
  let unlockableCount = 0;
  for (const ally of player.allies) {
    const metal = ally.metal;
    if (metal < 0 || metal >= 8) continue;
    if (!canBurnMetal(metal)) continue;
    const burned = player.metalBurned[metal];
    if (ally.available1 && burned === 0) unlockableCount++;
    if (ally.available2 && burned <= 1) unlockableCount++;
  }
  if (unlockableCount > 0) {
    reminders.push(`${unlockableCount} ally ${unlockableCount === 1 ? "ability" : "abilities"} available with a burn`);
  }

  return reminders;
}

export function ActionList({ actions, onAction, missionRemaining, player }: Props) {
  const endAction = actions.find((a) => a.code === 0);
  const blocked = missionRemaining > 0;
  const reminders = blocked ? [] : getReminders(player, actions);

  return (
    <div className="action-list">
      {endAction && (
        <>
          <button
            className={`action-btn end-turn-btn${blocked ? " disabled" : ""}`}
            onClick={() => { if (!blocked) onAction(endAction.index); }}
            title={blocked ? `Use remaining ${missionRemaining} mission first` : ""}
          >
            End Actions{blocked ? ` (${missionRemaining} mission left)` : ""}
          </button>
          {reminders.length > 0 && (
            <div className="end-turn-reminders">
              {reminders.map((r, i) => (
                <div key={i} className="end-turn-reminder">⚠ {r}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
