import { useState, useCallback, useRef } from "react";
import type { GameState, GameAction, BotLogEntry, PlayerData } from "../types/game";
import { GameSession, opponentTypeToKind } from "../engine/session";
import { resetCardIds } from "../engine/card";

export interface TurnRecap {
  trained?: number;
  mission?: number;
  healed?: number;
  damageToPlayer?: { name: string; amount: number };
  damageToAllies?: { name: string; amount: number }[];
  boughtCards?: string[];
}

const BUY_ACTION_TYPES = new Set(["buy", "buy_eliminate", "buy_with_boxings", "buy_elim_boxings"]);

// Session methods return Record<string, unknown>; this helper casts safely
interface SessionResult {
  error?: string;
  turnCount?: number;
  phase?: string;
  playerLog?: BotLogEntry[];
  botLog?: BotLogEntry[];
  availableActions?: GameAction[];
  [key: string]: unknown;
}

export interface LogEntry {
  turn: number;
  text: string;
  isBot?: boolean;
}

/** Strip trailing " (×N)" to get the base text for comparison */
function baseText(text: string): string {
  return text.replace(/\s*\(×\d+\)$/, "");
}

/** Merge consecutive identical entries into "X (×N)" */
function consolidateLog(entries: LogEntry[]): LogEntry[] {
  const result: LogEntry[] = [];
  for (const entry of entries) {
    const last = result[result.length - 1];
    if (last && baseText(last.text) === baseText(entry.text) && last.turn === entry.turn && last.isBot === entry.isBot) {
      const match = last.text.match(/^(.*?)(?:\s*\(×(\d+)\))?$/);
      if (match) {
        const base = match[1];
        const count = parseInt(match[2] ?? "1") + 1;
        last.text = `${base} (×${count})`;
      }
    } else {
      result.push({ ...entry });
    }
  }
  return result;
}

export function useGame() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [flashQueue, setFlashQueue] = useState<BotLogEntry[]>([]);
  const [recap, setRecap] = useState<TurnRecap | null>(null);
  const playerName = useRef("Player");
  const botName = useRef("Bot");
  const sessionRef = useRef<GameSession | null>(null);

  const enqueueFlashes = useCallback((entries: BotLogEntry[] | undefined) => {
    if (!entries) return;
    const withCards = entries.filter((e) => e.card && e.actionType !== "refresh_metal" && e.actionType !== "burn_card");
    if (withCards.length) setFlashQueue((q) => [...q, ...withCards]);
  }, []);

  const consumeFlash = useCallback(() => {
    setFlashQueue((q) => q.slice(1));
  }, []);

  const consumeRecap = useCallback(() => setRecap(null), []);

  const computeRecap = useCallback((before: GameState, data: SessionResult, turnLog?: BotLogEntry[]): TurnRecap | null => {
    const after = data as unknown as GameState;
    if (!after.players || after.players.length < 2) return null;
    const oldYou = before.players[0];
    const oldOpp = before.players[1];
    const newYou = after.players[0];
    const newOpp = after.players[1];
    const r: TurnRecap = {};
    const trained = newOpp.training - oldOpp.training;
    const healed = Math.max(0, newOpp.health - oldOpp.health);

    const bought = (turnLog ?? [])
      .filter((e) => e.actionType && BUY_ACTION_TYPES.has(e.actionType) && e.card)
      .map((e) => e.card!.name);
    if (bought.length) r.boughtCards = bought;

    // Mission progress lives in missions[].playerRanks[1] for the bot — sum deltas.
    let missionDelta = 0;
    const oldMissions = before.missions ?? [];
    const newMissions = after.missions ?? [];
    for (let i = 0; i < newMissions.length; i++) {
      const oldRank = oldMissions[i]?.playerRanks?.[1] ?? 0;
      const newRank = newMissions[i]?.playerRanks?.[1] ?? 0;
      if (newRank > oldRank) missionDelta += newRank - oldRank;
    }

    // Damage to the player (HP loss).
    const playerHpLoss = Math.max(0, oldYou.health - newYou.health);
    if (playerHpLoss > 0) r.damageToPlayer = { name: oldYou.name, amount: playerHpLoss };

    // Damage to player's allies: match old→new by id. Killed ones count full remaining HP.
    const allyDamage: { name: string; amount: number }[] = [];
    const newAllyById = new Map((newYou.allies ?? []).map((a) => [a.id, a]));
    for (const oldAlly of oldYou.allies ?? []) {
      const newAlly = newAllyById.get(oldAlly.id);
      const oldHp = oldAlly.health ?? 0;
      const newHp = newAlly?.health ?? 0;
      const killed = !newAlly;
      const dmg = killed ? oldHp : Math.max(0, oldHp - newHp);
      if (dmg > 0) allyDamage.push({ name: oldAlly.name, amount: dmg });
    }
    if (allyDamage.length) r.damageToAllies = allyDamage;

    if (trained > 0) r.trained = trained;
    if (missionDelta > 0) r.mission = missionDelta;
    if (healed > 0) r.healed = healed;
    return Object.keys(r).length > 0 ? r : null;
  }, []);

  const createGame = useCallback(
    (
      pName: string,
      character: string,
      opponentType: string,
      opponentCharacter: string,
      botFirst: boolean = true,
      testDeck: boolean = false
    ) => {
      setLoading(true);
      setError(null);
      setLog([]);
      playerName.current = pName;
      botName.current = `${opponentType.charAt(0).toUpperCase() + opponentType.slice(1)} Bot`;

      try {
        resetCardIds();
        const botKind = opponentTypeToKind(opponentType);
        const session = new GameSession({
          players: [
            { kind: "human", name: pName, character },
            { kind: botKind, name: `${opponentType.charAt(0).toUpperCase() + opponentType.slice(1)} Bot`, character: opponentCharacter },
          ],
          firstPlayer: botFirst ? 1 : 0,
          testDeck,
        });
        sessionRef.current = session;
        const data = session.getState(0) as unknown as GameState;
        setGameState(data);

        // Consume the initial log deltas (bot-first turn produces bot-log entries).
        const { botLogDelta } = session.consumeLogDeltas(0);

        const initLog: LogEntry[] = [{ turn: 1, text: "Game started" }];
        const bName = `${opponentType.charAt(0).toUpperCase() + opponentType.slice(1)} Bot`;
        if (botLogDelta.length > 0) {
          initLog.push({ turn: 1, text: `${bName}'s turn`, isBot: true });
          for (const entry of botLogDelta) {
            initLog.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true });
          }
          enqueueFlashes(botLogDelta);
          // Bot's very first turn (bot-first): reconstruct starting HP from engine rule
          // (36 + 2*turnOrder, Prodigy = 40). Training/mission/ranks always start at 0.
          const startHp = (p: PlayerData) =>
            p.character === "Prodigy" ? 40 : 36 + 2 * p.turnOrder;
          const baseline: GameState = {
            ...data,
            players: [
              { ...data.players[0], health: startHp(data.players[0]) },
              { ...data.players[1], training: 0, health: startHp(data.players[1]) },
            ],
            missions: [],
          };
          const r = computeRecap(baseline, data as unknown as SessionResult, botLogDelta);
          if (r) setRecap(r);
        }
        if (data.turnCount > 1) {
          initLog.push({ turn: data.turnCount, text: `${pName}'s turn` });
        }
        setLog(initLog);
        return data;
      } catch (e) {
        setError(String(e));
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const playAction = useCallback(
    (actionIndex: number) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      const action = gameState.availableActions.find((a) => a.index === actionIndex);
      const desc = action?.description ?? `Action ${actionIndex}`;
      const prevTurn = gameState.turnCount;
      const pName = playerName.current;
      const bName = botName.current;

      setError(null);
      try {
        const data = session.playAction(0, actionIndex) as SessionResult;
        if (data.error) { setError(data.error); return null; }
        setGameState(data as unknown as GameState);
        const { playerLogDelta, botLogDelta } = session.consumeLogDeltas(0);

        const newEntries: LogEntry[] = [
          { turn: prevTurn, text: `${pName} — ${desc}` },
        ];

        const newTurnPlayerLogs: LogEntry[] = [];
        if (playerLogDelta.length > 0) {
          for (const entry of playerLogDelta) {
            if (entry.turn > prevTurn) {
              newTurnPlayerLogs.push({ turn: entry.turn, text: `  → ${entry.text}` });
            } else {
              newEntries.push({ turn: entry.turn, text: `  → ${entry.text}` });
            }
          }
        }

        if (botLogDelta.length > 0) {
          const botTurn = botLogDelta[0]?.turn ?? prevTurn + 1;
          newEntries.push({ turn: botTurn, text: `${bName}'s turn`, isBot: true });
          for (const entry of botLogDelta) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true });
          }
          enqueueFlashes(botLogDelta);
          const r = computeRecap(gameState, data, botLogDelta);
          if (r) setRecap(r);
        }

        if ((data.turnCount ?? 0) > prevTurn) {
          newEntries.push({ turn: data.turnCount!, text: `${pName}'s turn` });
        }
        newEntries.push(...newTurnPlayerLogs);

        setLog((prev) => consolidateLog([...prev, ...newEntries]));
        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState]
  );

  const advanceAllMission = useCallback(
    (missionName: string) => {
      if (!gameState) return;
      const session = sessionRef.current;
      if (!session) return;

      // Find and play all mission advances for this mission
      let current: GameState | null = gameState;
      while (current) {
        const action = current.availableActions.find(
          (a) => a.code === 1 && a.missionName === missionName
        );
        if (!action) break;
        const result = playAction(action.index) as unknown as GameState | null;
        if (!result || result.phase === "game_over") break;
        current = result;
      }
    },
    [gameState, playAction]
  );

  const playTwoActions = useCallback(
    (firstIndex: number, secondMatch: { code: number; cardIds?: number[] }) => {
      const first = playAction(firstIndex) as unknown as SessionResult | null;
      if (!first) return null;
      const actions = (first.availableActions ?? []) as GameAction[];
      const second = actions.find((a) => a.code === secondMatch.code
        && (secondMatch.cardIds === undefined || (a.cardId !== undefined && secondMatch.cardIds.includes(a.cardId))));
      if (!second) return first;
      return playAction(second.index);
    },
    [playAction]
  );

  const respondToPrompt = useCallback(
    (promptType: string, value: number) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.respondToPrompt(0, promptType, value) as SessionResult;
        if (data.error) { setError(data.error); return null; }
        setGameState(data as unknown as GameState);
        const { playerLogDelta, botLogDelta } = session.consumeLogDeltas(0);

        const newEntries: LogEntry[] = [];
        const bName = botName.current;
        const pName = playerName.current;

        if (playerLogDelta.length > 0) {
          for (const entry of playerLogDelta) {
            newEntries.push({ turn: entry.turn, text: `  → ${entry.text}` });
          }
        }

        if (botLogDelta.length > 0) {
          const botTurn = botLogDelta[0]?.turn ?? gameState.turnCount + 1;
          newEntries.push({ turn: botTurn, text: `${bName}'s turn`, isBot: true });
          for (const entry of botLogDelta) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true });
          }
          enqueueFlashes(botLogDelta);
          const r = computeRecap(gameState, data, botLogDelta);
          if (r) setRecap(r);
        }

        if ((data.turnCount ?? 0) > gameState.turnCount) {
          newEntries.push({ turn: data.turnCount!, text: `${pName}'s turn` });
        }

        if (newEntries.length > 0) {
          setLog((prev) => consolidateLog([...prev, ...newEntries]));
        }

        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState]
  );

  const assignDamage = useCallback(
    (targetIndex: number) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.assignDamage(0, targetIndex) as SessionResult;
        if (data.error) { setError(data.error); return null; }
        setGameState(data as unknown as GameState);
        const { playerLogDelta, botLogDelta } = session.consumeLogDeltas(0);

        const newEntries: LogEntry[] = [];
        const bName = botName.current;
        const pName = playerName.current;

        if (targetIndex === -1) {
          const dmg = gameState.players[0].damage;
          if (dmg > 0) {
            newEntries.push({ turn: gameState.turnCount, text: `${pName} dealt ${dmg} damage to ${bName}` });
          }
        } else {
          const target = gameState.damageTargets?.find((t) => t.index === targetIndex);
          newEntries.push({ turn: gameState.turnCount, text: `${pName} killed ${target?.name ?? "ally"} (${target?.health ?? "?"} HP)` });
        }

        if (playerLogDelta.length > 0) {
          for (const entry of playerLogDelta) {
            newEntries.push({ turn: entry.turn, text: `  → ${entry.text}` });
          }
        }

        if (botLogDelta.length > 0) {
          const botTurn = botLogDelta[0]?.turn ?? gameState.turnCount + 1;
          newEntries.push({ turn: botTurn, text: `${bName}'s turn`, isBot: true });
          for (const entry of botLogDelta) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true });
          }
          enqueueFlashes(botLogDelta);
          const r = computeRecap(gameState, data, botLogDelta);
          if (r) setRecap(r);
        }

        if ((data.turnCount ?? 0) > gameState.turnCount) {
          newEntries.push({ turn: data.turnCount!, text: `${pName}'s turn` });
        }

        if (newEntries.length > 0) {
          setLog((prev) => consolidateLog([...prev, ...newEntries]));
        }

        return data;
      } catch (e) {
        setError(String(e));
        return null;
      }
    },
    [gameState]
  );

  const resolveSense = useCallback(
    (use: boolean) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.resolveSense(0, use) as SessionResult;
        if (data.error) { setError(data.error); return null; }
        setGameState(data as unknown as GameState);
        const { playerLogDelta, botLogDelta } = session.consumeLogDeltas(0);

        const newEntries: LogEntry[] = [];
        const bName = botName.current;
        const pName = playerName.current;

        if (use) {
          newEntries.push({ turn: gameState.turnCount, text: `${pName} — Sense defense active this turn` });
        }

        if (playerLogDelta.length) {
          for (const entry of playerLogDelta) {
            newEntries.push({ turn: entry.turn, text: `  → ${entry.text}` });
          }
        }
        if (botLogDelta.length) {
          const botTurn = botLogDelta[0]?.turn ?? gameState.turnCount;
          newEntries.push({ turn: botTurn, text: `${bName}'s turn`, isBot: true });
          for (const entry of botLogDelta) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true });
          }
          enqueueFlashes(botLogDelta);
          const r = computeRecap(gameState, data, botLogDelta);
          if (r) setRecap(r);
        }
        if ((data.turnCount ?? 0) > gameState.turnCount) {
          newEntries.push({ turn: data.turnCount!, text: `${pName}'s turn` });
        }
        if (newEntries.length > 0) setLog((prev) => consolidateLog([...prev, ...newEntries]));
        return data;
      } catch (e) { setError(String(e)); return null; }
    }, [gameState]
  );

  const resolveCloud = useCallback(
    (cardId: number) => {
      const session = sessionRef.current;
      if (!session || !gameState) return null;
      setError(null);
      try {
        const data = session.resolveCloud(0, cardId) as SessionResult;
        if (data.error) { setError(data.error); return null; }
        setGameState(data as unknown as GameState);
        const { playerLogDelta, botLogDelta } = session.consumeLogDeltas(0);

        const newEntries: LogEntry[] = [];
        const bName = botName.current;
        const pName = playerName.current;

        if (playerLogDelta.length) {
          for (const entry of playerLogDelta) {
            newEntries.push({ turn: entry.turn, text: `  → ${entry.text}` });
          }
        }
        if (botLogDelta.length) {
          for (const entry of botLogDelta) {
            newEntries.push({ turn: entry.turn, text: `${bName} — ${entry.text}`, isBot: true });
          }
          enqueueFlashes(botLogDelta);
          const r = computeRecap(gameState, data, botLogDelta);
          if (r) setRecap(r);
        }
        if ((data.turnCount ?? 0) > gameState.turnCount) {
          newEntries.push({ turn: data.turnCount!, text: `${pName}'s turn` });
        }
        if (newEntries.length > 0) setLog((prev) => consolidateLog([...prev, ...newEntries]));
        return data;
      } catch (e) { setError(String(e)); return null; }
    }, [gameState]
  );

  const undo = useCallback(() => {
    const session = sessionRef.current;
    if (!session || !session.canUndo()) return;

    const pName = playerName.current;

    // Restore in place — session handles state rollback and log cleanup.
    const ok = session.undo();
    if (!ok) return;

    const data = session.getState(0) as unknown as GameState;
    setGameState(data);

    // Session's own log entry was removed by undo() — also remove the matching
    // "Player — <action description>" line from the hook-side log.
    setLog((prev) => {
      const result = [...prev];
      for (let i = result.length - 1; i >= 0; i--) {
        if (!result[i].isBot && result[i].text.startsWith(`${pName} — `)) {
          result.splice(i, 1);
          break;
        }
      }
      return result;
    });
  }, []);

  const refreshState = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    setGameState(session.getState(0) as unknown as GameState);
  }, []);

  return {
    gameState,
    loading,
    error,
    log,
    flashQueue,
    consumeFlash,
    recap,
    consumeRecap,
    createGame,
    playAction,
    advanceAllMission,
    playTwoActions,
    assignDamage,
    resolveSense,
    resolveCloud,
    respondToPrompt,
    refreshState,
    undo,
    canUndo: gameState?.canUndo ?? false,
  };
}
