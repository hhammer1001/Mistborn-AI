/**
 * Shared turn-driven UI side effects: card-flash queue, opponent turn recap,
 * and the "your turn / opponent's turn" banner state machine.
 *
 * Unified for SP and MP, with different triggers:
 *   - SP: bot turn is atomic (one state update). We detect "opp turn ended"
 *     by `botLog` growth while `isMyTurn` stays true, and use `prev` as the
 *     turn-start baseline.
 *   - MP: opp turn is incremental (many state updates). We snapshot a
 *     turn-start state on `my → opp` transition and compute the recap
 *     cumulatively on `opp → my` transition.
 *
 * In both modes, flashes are queued on every botLog growth. The "your turn"
 * banner fires only when it's actually my turn AND the flash queue + recap
 * have both drained.
 *
 * SP's "opponent" banner must be triggered imperatively via the returned
 * `setBanner` (the declarative my→opp transition never fires there since
 * isMyTurn is always true). SP's bot-first recap (no prior snapshot) is
 * handled imperatively via `pushRecap`.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { GameState, BotLogEntry, CardData } from "../types/game";

export interface TurnRecap {
  trained?: number;
  mission?: number;
  healed?: number;
  damageToPlayer?: { name: string; amount: number };
  damageToAllies?: { name: string; amount: number }[];
  boughtCards?: string[];
  boxingsGained?: number;
}

/** Log entry shape understood by the activity log component. */
export interface RecapLogEntry {
  turn: number;
  text: string;
  isBot?: boolean;
  card?: CardData;
  actionType?: string;
  metalIndex?: number;
  recap?: TurnRecap;
}

const BUY_ACTION_TYPES = new Set([
  "buy", "buy_eliminate", "buy_with_boxings", "buy_elim_boxings",
]);

/** Exported so callers (e.g., useGame bot-first) can compute recaps from a
 *  synthetic baseline outside the hook's internal observation cycle. */
export function computeRecap(
  prev: GameState,
  next: GameState,
  newBotEntries: BotLogEntry[],
  me: number,
  opp: number,
): TurnRecap | null {
  const prevYou = prev.players[me];
  const prevOpp = prev.players[opp];
  const nextYou = next.players[me];
  const nextOpp = next.players[opp];
  if (!prevYou || !prevOpp || !nextYou || !nextOpp) return null;

  const r: TurnRecap = {};

  const trained = nextOpp.training - prevOpp.training;
  // Measure healing against the opponent's true turn-start HP when available.
  // In SP the human's attack and the bot's turn run in one synchronous call,
  // so the render-based `prev` predates the damage — a heal that just undoes
  // that damage would net to zero against prevOpp.health. turnStartHealth is
  // captured inside the engine after the attack lands, giving the right base.
  const capturedStartHp = next.turnStartHealth?.[opp];
  const oppTurnStartHp = typeof capturedStartHp === "number" && capturedStartHp >= 0
    ? capturedStartHp
    : prevOpp.health;
  const healed = Math.max(0, nextOpp.health - oppTurnStartHp);

  const playerHpLoss = Math.max(0, prevYou.health - nextYou.health);
  if (playerHpLoss > 0) r.damageToPlayer = { name: prevYou.name, amount: playerHpLoss };

  const bought = newBotEntries
    .filter((e) => e.actionType && BUY_ACTION_TYPES.has(e.actionType) && e.card)
    .map((e) => e.card!.name);
  if (bought.length) r.boughtCards = bought;

  const boxingsGained = Math.max(0, nextOpp.boxings - prevOpp.boxings);
  if (boxingsGained > 0) r.boxingsGained = boxingsGained;

  let missionDelta = 0;
  const oldMissions = prev.missions ?? [];
  const newMissions = next.missions ?? [];
  for (let i = 0; i < newMissions.length; i++) {
    const oldRank = oldMissions[i]?.playerRanks?.[opp] ?? 0;
    const newRank = newMissions[i]?.playerRanks?.[opp] ?? 0;
    if (newRank > oldRank) missionDelta += newRank - oldRank;
  }

  const allyDamage: { name: string; amount: number }[] = [];
  const newAllyById = new Map((nextYou.allies ?? []).map((a) => [a.id, a]));
  for (const oldAlly of prevYou.allies ?? []) {
    const newAlly = newAllyById.get(oldAlly.id);
    const oldHp = oldAlly.health ?? 0;
    const newHp = newAlly?.health ?? 0;
    const killed = !newAlly;
    const dmg = killed ? oldHp : Math.max(0, oldHp - newHp);
    if (dmg > 0) allyDamage.push({ name: oldAlly.name, amount: dmg });
  }
  if (allyDamage.length) r.damageToAllies = allyDamage;

  // Skip "1 trained" — that's the baseline end-of-turn training, not interesting.
  if (trained > 1) r.trained = trained;
  if (missionDelta > 0) r.mission = missionDelta;
  if (healed > 0) r.healed = healed;

  return Object.keys(r).length > 0 ? r : null;
}

export interface UseTurnSideEffectsOpts {
  gameState: GameState | null;
  perspective: number;
  isMyTurn: boolean;
}

export function useTurnSideEffects(opts: UseTurnSideEffectsOpts) {
  const { gameState, perspective, isMyTurn } = opts;
  const me = perspective;
  const opp = 1 - perspective;

  const [flashQueue, setFlashQueue] = useState<BotLogEntry[]>([]);
  const [recap, setRecap] = useState<TurnRecap | null>(null);
  const [banner, setBanner] = useState<"your" | "opponent" | null>(null);
  const [recapEntries, setRecapEntries] = useState<RecapLogEntry[]>([]);

  const expectYourBannerRef = useRef(false);
  const prevGameStateRef = useRef<GameState | null>(null);
  const prevIsMyTurnRef = useRef<boolean | null>(null);
  const seenBotLogLenRef = useRef(0);
  // Turn-start snapshot (for MP): state at the moment opp's turn started.
  const turnStartStateRef = useRef<GameState | null>(null);
  const turnStartBotLogLenRef = useRef(0);

  const consumeFlash = useCallback(() => setFlashQueue((q) => q.slice(1)), []);
  const consumeRecap = useCallback(() => setRecap(null), []);
  const consumeBanner = useCallback(() => setBanner(null), []);
  /** Drop all collected recap log entries — call when starting a new game. */
  const clearRecapEntries = useCallback(() => setRecapEntries([]), []);

  /** Drop any queued card flashes and the recap modal. Call when the player
   *  takes an action: they're playing now and shouldn't be ambushed mid-turn
   *  by leftover opponent-turn animations. The recap log entry (already
   *  pinned at the end of the bot's turn) is preserved. */
  const skipTurnAnimations = useCallback(() => {
    setFlashQueue([]);
    setRecap(null);
  }, []);

  /** Imperatively push a turn recap + log entry + flag for your-turn banner.
   *  Used for SP bot-first where no prior snapshot exists to diff against. */
  const pushRecap = useCallback((r: TurnRecap, turn: number, oppName: string) => {
    setRecap(r);
    setRecapEntries((list) => [...list, {
      turn,
      text: `— ${oppName} turn recap —`,
      isBot: true,
      recap: r,
    }]);
    expectYourBannerRef.current = true;
  }, []);

  /** Flag that a "your turn" banner should fire once flashes + recap drain.
   *  Useful when an opp turn produced no recap content but we still want the
   *  banner (e.g., bot-first turn with only baseline training). */
  const flagExpectYourBanner = useCallback(() => {
    expectYourBannerRef.current = true;
  }, []);

  useEffect(() => {
    if (!gameState) {
      prevGameStateRef.current = null;
      prevIsMyTurnRef.current = null;
      seenBotLogLenRef.current = 0;
      turnStartStateRef.current = null;
      turnStartBotLogLenRef.current = 0;
      expectYourBannerRef.current = false;
      setFlashQueue([]);
      setRecap(null);
      setBanner(null);
      setRecapEntries([]);
      return;
    }

    const botLog = (gameState.botLog ?? []) as BotLogEntry[];
    const prev = prevGameStateRef.current;
    const prevIsMyTurn = prevIsMyTurnRef.current;
    const seenLen = seenBotLogLenRef.current;

    // 1. Flash queue: always append newly-observed bot-log entries (filtered).
    if (botLog.length > seenLen) {
      const newEntries = botLog.slice(seenLen).filter(
        (e) => e.card && e.actionType !== "refresh_metal" && e.actionType !== "burn_card",
      );
      if (newEntries.length) setFlashQueue((q) => [...q, ...newEntries]);
    }

    // 2. Turn transitions.
    // sense_defense / cloud_defense flip activePlayer to the defender mid-opp-turn
    // for a defensive prompt, then flip back. Those flips look like turn boundaries
    // but aren't — treating them as such splits a single opp turn's recap in two.
    const enteringDefenseInterrupt =
      gameState.phase === "sense_defense"
      || gameState.phase === "cloud_defense"
      || gameState.phase === "ally_defense";
    const resumingFromDefenseInterrupt =
      prev?.phase === "sense_defense"
      || prev?.phase === "cloud_defense"
      || prev?.phase === "ally_defense";

    // MP: my → opp — snapshot turn-start state and fire opponent banner.
    // Skip when resuming from a defense interrupt: the existing baseline (set at
    // the real turn start) must be preserved so the final recap covers the whole turn.
    const oppTurnStartedMP =
      prev && prevIsMyTurn === true && !isMyTurn && !resumingFromDefenseInterrupt;
    if (oppTurnStartedMP) {
      turnStartStateRef.current = prev;
      turnStartBotLogLenRef.current = botLog.length;
      setBanner("opponent");
    }

    // SP: capture turn-start baseline on first bot activity. Preserved across
    // defense interrupts (sense_defense, cloud_defense) so the final recap
    // covers the whole bot turn, not just the post-interrupt portion.
    const spBotActivity =
      prevIsMyTurn === true && isMyTurn && botLog.length > seenLen;
    if (spBotActivity && turnStartStateRef.current === null && prev) {
      turnStartStateRef.current = prev;
      turnStartBotLogLenRef.current = seenLen;
    }

    // Opp turn ended — compute cumulative recap.
    //   MP: opp → my transition (prev was false, now true).
    //   SP: isMyTurn stays true; detect via botLog growth (bot turn is atomic
    //       absent defense interrupts, multi-step otherwise).
    // Skip when entering a defense interrupt: it's a mid-turn prompt, not a turn end.
    //
    // SP defense-interrupt exit: when the bot's turn ended via the player
    // resolving cloud/sense defense AND the player took no entries from the
    // bot's log (skipped), botLog doesn't grow on the resolve step. Detect
    // that the bot's turn truly ended via (resuming from defense interrupt
    // + turncount advanced) so the recap fires now — otherwise it leaks
    // into the next bot reaction (a sense_block during the player's next
    // turn) and renders with that turn's number.
    const defenseInterruptEndedBotTurn =
      prev && resumingFromDefenseInterrupt
      && gameState.phase === "actions"
      && gameState.turnCount > (prev.turnCount ?? 0);
    const oppTurnEndedMP =
      prev && prevIsMyTurn === false && isMyTurn && !enteringDefenseInterrupt;
    const oppTurnEndedSP =
      prev && prevIsMyTurn === true && isMyTurn
      && (botLog.length > seenLen || defenseInterruptEndedBotTurn)
      && !enteringDefenseInterrupt;

    if (oppTurnEndedMP || oppTurnEndedSP) {
      const baselineState = turnStartStateRef.current ?? prev;
      const baseLogLen = turnStartStateRef.current ? turnStartBotLogLenRef.current : seenLen;
      if (baselineState) {
        const turnEntries = botLog.slice(baseLogLen);
        if (turnEntries.length) {
          const r = computeRecap(baselineState, gameState, turnEntries, me, opp);
          if (r) {
            setRecap(r);
            const lastEntry = turnEntries[turnEntries.length - 1];
            const oppName = gameState.players[opp]?.name ?? "Opponent";
            setRecapEntries((list) => [...list, {
              turn: lastEntry?.turn ?? gameState.turnCount,
              text: `— ${oppName} turn recap —`,
              isBot: true,
              recap: r,
            }]);
          }
        }
      }
      // Always flag your-turn banner — even if the opp's turn produced no
      // recap-worthy content, the banner should still greet the next turn.
      expectYourBannerRef.current = true;
      // Clear SP turn-start snapshot now that we've consumed it. (MP retains
      // the snapshot; it's overwritten on the next opp turn start.)
      if (oppTurnEndedSP) {
        turnStartStateRef.current = null;
        turnStartBotLogLenRef.current = 0;
      }
    }

    prevGameStateRef.current = gameState;
    prevIsMyTurnRef.current = isMyTurn;
    seenBotLogLenRef.current = botLog.length;
  }, [gameState, isMyTurn, me, opp]);

  // "Your turn" banner: fires only when it's actually my turn AND the flash
  // queue / recap modal have both drained. The isMyTurn gate prevents it
  // firing mid-opp-turn in MP (where flashes and per-turn recap might drain
  // before the turn actually ends).
  useEffect(() => {
    if (isMyTurn && flashQueue.length === 0 && recap === null && expectYourBannerRef.current) {
      expectYourBannerRef.current = false;
      setBanner("your");
    }
  }, [flashQueue, recap, isMyTurn]);

  return {
    flashQueue,
    recap,
    banner,
    recapEntries,
    consumeFlash,
    consumeRecap,
    consumeBanner,
    clearRecapEntries,
    setBanner,
    pushRecap,
    flagExpectYourBanner,
    skipTurnAnimations,
  };
}
