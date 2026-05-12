import { useCallback, useEffect, useRef, useState } from "react";
import { LandsSession, type SessionConfig } from "../engine/session";
import { FlowchartLandsBot, LandsBot, RandomLandsBot, type ILandsBot } from "../engine/bot";
import type { GameState } from "../engine/types";
import {
  saveLandsMatchRecord,
  SYSTEM_BOT_PROFILE_ID,
  type LandsMatchIdentity,
} from "../lib/landsMatchLog";

const BOT_DELAY_MS = 600;

export type LandsBotKind = "heuristic" | "flowchart" | "random";

export interface StartOpts {
  botKind?: LandsBotKind;
  /** Display name for the bot opponent (used in logs + UI). */
  opponentName?: string;
  /** Display name for the human player (used in logs + UI). Defaults to
   *  "Player" — a generic third-person name keeps verb agreement correct in
   *  log lines ("Player plays Plains" not "You plays Plains"). */
  playerName?: string;
  /** Identity of the human player. When provided, the hook logs the finished
   *  match to `landsMatches` / `landsMatchPlayers` on game_over. */
  humanIdentity?: LandsMatchIdentity;
}

export interface UseLandsGameApi {
  state: GameState | null;
  /** Seat of the human player (0 or 1). */
  humanSeat: 0 | 1;
  start: (humanFirst: boolean, opts?: StartOpts) => void;
  end: () => void;
  /** Human passes their main step. */
  passMain: () => void;
  /** Human plays a card from their hand. */
  playCard: (cardId: number) => void;
  /** Human declines to counter. */
  declineCounter: () => void;
  /** Human counters (discards island + matching). */
  counter: (islandId: number, matchId: number) => void;
  resolveMountain: (targetId: number) => void;
  resolveSwamp: (targetId: number) => void;
  resolveForest: (cardId: number) => void;
  resolveIsland: (discardIds: number[], keepOrderIds: number[]) => void;
}

/**
 * Hook that drives a single-player Lands game vs the heuristic bot.
 * Human is always seat 0; bot is seat 1. Who-goes-first is a choice at start.
 */
export function useLandsGame(): UseLandsGameApi {
  const [state, setState] = useState<GameState | null>(null);
  const sessionRef = useRef<LandsSession | null>(null);
  const botRef = useRef<ILandsBot | null>(null);
  const botTimerRef = useRef<number | null>(null);
  const humanSeat: 0 | 1 = 0;

  const clearBotTimer = useCallback(() => {
    if (botTimerRef.current != null) {
      window.clearTimeout(botTimerRef.current);
      botTimerRef.current = null;
    }
  }, []);

  const scheduleBot = useCallback((s: GameState) => {
    if (!botRef.current) return;
    if (s.phase === "game_over") return;
    // The bot acts when it's its turn for the current phase. We check by
    // asking the bot to inspect; if it would act, schedule a delayed call.
    const bot = botRef.current;
    const isBotMain = s.phase === "main" && s.activePlayer === bot.seat;
    const isBotEffect =
      s.activePlayer === bot.seat &&
      (s.phase === "mountain_target" ||
        s.phase === "swamp_view" ||
        s.phase === "forest_pick" ||
        s.phase === "island_scry");
    const isBotCounter =
      s.phase === "counter_window" && s.activePlayer !== bot.seat;
    if (!isBotMain && !isBotEffect && !isBotCounter) return;

    clearBotTimer();
    botTimerRef.current = window.setTimeout(() => {
      botTimerRef.current = null;
      bot.step(s);
    }, BOT_DELAY_MS);
  }, [clearBotTimer]);

  const matchWrittenRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const matchCtxRef = useRef<{
    botKind: LandsBotKind;
    humanIdentity: LandsMatchIdentity;
    botName: string;
  } | null>(null);

  const start = useCallback(
    (humanFirst: boolean, opts: StartOpts = {}) => {
      const {
        botKind = "heuristic",
        opponentName = "Bot",
        playerName = "Player",
        humanIdentity,
      } = opts;
      clearBotTimer();
      const cfg: SessionConfig = {
        playerNames: [playerName, opponentName],
        firstPlayer: humanFirst ? 0 : 1,
      };
      const session = new LandsSession(cfg);
      const bot: ILandsBot =
        botKind === "random"
          ? new RandomLandsBot(session, 1)
          : botKind === "flowchart"
            ? new FlowchartLandsBot(session, 1)
            : new LandsBot(session, 1);
      sessionRef.current = session;
      botRef.current = bot;
      matchWrittenRef.current = false;
      startedAtRef.current = Date.now();
      matchCtxRef.current = humanIdentity
        ? { botKind, humanIdentity, botName: opponentName }
        : null;
      session.subscribe((snap) => {
        setState(snap);
        scheduleBot(snap);
        // First reach of game_over → log the finished match (once). Skip if
        // we don't have a human identity (e.g. running outside an authed
        // session — the match would have empty userId/profileId).
        if (
          snap.phase === "game_over" &&
          !matchWrittenRef.current &&
          matchCtxRef.current &&
          startedAtRef.current != null
        ) {
          matchWrittenRef.current = true;
          const ctx = matchCtxRef.current;
          void saveLandsMatchRecord({
            state: snap,
            kind: "lands_bot",
            botKind: ctx.botKind,
            startedAt: startedAtRef.current,
            identities: [
              ctx.humanIdentity,
              {
                profileId: SYSTEM_BOT_PROFILE_ID,
                userId: "",
                name: ctx.botName,
              },
            ],
            isBot: [false, true],
          }).catch((e) => console.error("saveLandsMatchRecord failed:", e));
        }
      });
    },
    [clearBotTimer, scheduleBot],
  );

  const end = useCallback(() => {
    clearBotTimer();
    sessionRef.current = null;
    botRef.current = null;
    setState(null);
  }, [clearBotTimer]);

  useEffect(() => () => clearBotTimer(), [clearBotTimer]);

  const playCard = useCallback((cardId: number) => {
    sessionRef.current?.playCard(cardId);
  }, []);
  const passMain = useCallback(() => {
    sessionRef.current?.passMain();
  }, []);
  const declineCounter = useCallback(() => {
    sessionRef.current?.declineCounter();
  }, []);
  const counter = useCallback((islandId: number, matchId: number) => {
    sessionRef.current?.counter(islandId, matchId);
  }, []);
  const resolveMountain = useCallback((targetId: number) => {
    sessionRef.current?.resolveMountain(targetId);
  }, []);
  const resolveSwamp = useCallback((targetId: number) => {
    sessionRef.current?.resolveSwamp(targetId);
  }, []);
  const resolveForest = useCallback((cardId: number) => {
    sessionRef.current?.resolveForest(cardId);
  }, []);
  const resolveIsland = useCallback(
    (discardIds: number[], keepOrderIds: number[]) => {
      sessionRef.current?.resolveIsland(discardIds, keepOrderIds);
    },
    [],
  );

  return {
    state,
    humanSeat,
    start,
    end,
    passMain,
    playCard,
    declineCounter,
    counter,
    resolveMountain,
    resolveSwamp,
    resolveForest,
    resolveIsland,
  };
}
