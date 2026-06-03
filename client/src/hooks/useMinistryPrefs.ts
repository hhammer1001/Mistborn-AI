import { useEffect, useState, useCallback } from "react";
import { BOT_TYPES, VICTORY_TYPES, type BotType, type VictoryType } from "../data/ministrySigils";

const KEY_SIGIL          = "ministry.sigil";
const KEY_FLARED         = "ministry.flared";
const KEY_FILTER         = "ministry.filter";
const KEY_LOG_VISIBLE    = "ministry.logVisibleFilters";
const KEY_BOT_CFG        = "mistborn.botConfig";
const KEY_LANDS_UNLOCKED = "mistborn.landsUnlocked";
const KEY_LANDS_ENABLED  = "mistborn.landsEnabled";

export type FirstPlayerChoice = "you" | "bot" | "random";

export interface BotSetupConfig {
  myChar: string;
  oppChar: string;
  botType: BotType;
  firstPlayer: FirstPlayerChoice;
  testDeck: boolean;
}

export const DEFAULT_BOT_CONFIG: BotSetupConfig = {
  myChar: "Random",
  oppChar: "Random",
  botType: "hulk",
  firstPlayer: "random",
  testDeck: false,
};

export type LogMode = "all" | "bot" | "human";
export type FirstPlayerFilter = "all" | "me" | "opp";

export interface LogFilter {
  mode: LogMode;
  bots: BotType[];
  victories: VictoryType[];
  firstPlayer: FirstPlayerFilter;
}

export const DEFAULT_FILTER: LogFilter = {
  mode: "all",
  bots: [...BOT_TYPES],
  victories: [...VICTORY_TYPES],
  firstPlayer: "all",
};

/** Filter controls the full Ministry Log can show, and which ones appear by
 *  default. Users customize the visible set via the log's "⚙ Filters" menu. */
export type LogFilterKey = "result" | "mode" | "first" | "bot" | "vic" | "char" | "search";
export const LOG_FILTER_KEYS: LogFilterKey[] = ["result", "mode", "first", "bot", "vic", "char", "search"];
export const DEFAULT_LOG_VISIBLE: LogFilterKey[] = ["result", "mode", "bot", "search"];

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && !Array.isArray(fallback)) {
      return { ...fallback as object, ...parsed } as T;
    }
    return parsed as T;
  } catch {
    return fallback;
  }
}

/** Migrate older saved configs (pre-multi-option firstPlayer) so existing
 *  localStorage doesn't break. youFirst:bool → firstPlayer:"you"|"bot". */
function migrateBotConfig(c: BotSetupConfig & { youFirst?: boolean }): BotSetupConfig {
  if (c.firstPlayer) return c;
  return { ...c, firstPlayer: c.youFirst ? "you" : "bot" };
}

export function useMinistryPrefs() {
  const [sigil, setSigilState]   = useState<string>(() => localStorage.getItem(KEY_SIGIL)  ?? "steel");
  const [flared, setFlaredState] = useState<boolean>(() => localStorage.getItem(KEY_FLARED) === "true");
  const [botConfig, setBotConfigState] = useState<BotSetupConfig>(() =>
    migrateBotConfig(readJSON<BotSetupConfig>(KEY_BOT_CFG, DEFAULT_BOT_CONFIG)),
  );
  const [filter, setFilterState] = useState<LogFilter>(() =>
    readJSON<LogFilter>(KEY_FILTER, DEFAULT_FILTER),
  );
  const [logVisibleFilters, setLogVisibleState] = useState<LogFilterKey[]>(() =>
    readJSON<LogFilterKey[]>(KEY_LOG_VISIBLE, DEFAULT_LOG_VISIBLE),
  );
  const [landsUnlocked, setLandsUnlockedState] = useState<boolean>(
    () => localStorage.getItem(KEY_LANDS_UNLOCKED) === "true",
  );
  const [landsEnabled, setLandsEnabledState] = useState<boolean>(
    () => localStorage.getItem(KEY_LANDS_ENABLED) === "true",
  );

  const setSigil = useCallback((k: string) => {
    setSigilState(k);
    localStorage.setItem(KEY_SIGIL, k);
  }, []);

  const setFlared = useCallback((b: boolean) => {
    setFlaredState(b);
    localStorage.setItem(KEY_FLARED, String(b));
  }, []);

  const setBotConfig = useCallback((cfg: BotSetupConfig) => {
    setBotConfigState(cfg);
    localStorage.setItem(KEY_BOT_CFG, JSON.stringify(cfg));
  }, []);

  const setFilter = useCallback((f: LogFilter) => {
    setFilterState(f);
    localStorage.setItem(KEY_FILTER, JSON.stringify(f));
  }, []);

  const setLogVisibleFilters = useCallback((keys: LogFilterKey[]) => {
    setLogVisibleState(keys);
    localStorage.setItem(KEY_LOG_VISIBLE, JSON.stringify(keys));
  }, []);

  const setLandsUnlocked = useCallback((b: boolean) => {
    setLandsUnlockedState(b);
    localStorage.setItem(KEY_LANDS_UNLOCKED, String(b));
    // Locking the easter egg also disables the swap, so the menu doesn't
    // mysteriously stay swapped after the user re-hides the flag.
    if (!b) {
      setLandsEnabledState(false);
      localStorage.setItem(KEY_LANDS_ENABLED, "false");
    }
  }, []);

  const setLandsEnabled = useCallback((b: boolean) => {
    setLandsEnabledState(b);
    localStorage.setItem(KEY_LANDS_ENABLED, String(b));
  }, []);

  // React to storage events so other tabs stay in sync.
  useEffect(() => {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === KEY_SIGIL && ev.newValue)  setSigilState(ev.newValue);
      if (ev.key === KEY_FLARED)                setFlaredState(ev.newValue === "true");
      if (ev.key === KEY_BOT_CFG && ev.newValue) setBotConfigState(migrateBotConfig(readJSON<BotSetupConfig>(KEY_BOT_CFG, DEFAULT_BOT_CONFIG)));
      if (ev.key === KEY_FILTER && ev.newValue)  setFilterState(readJSON<LogFilter>(KEY_FILTER, DEFAULT_FILTER));
      if (ev.key === KEY_LOG_VISIBLE && ev.newValue) setLogVisibleState(readJSON<LogFilterKey[]>(KEY_LOG_VISIBLE, DEFAULT_LOG_VISIBLE));
      if (ev.key === KEY_LANDS_UNLOCKED) setLandsUnlockedState(ev.newValue === "true");
      if (ev.key === KEY_LANDS_ENABLED)  setLandsEnabledState(ev.newValue === "true");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return {
    sigil, setSigil,
    flared, setFlared,
    botConfig, setBotConfig,
    filter, setFilter,
    logVisibleFilters, setLogVisibleFilters,
    landsUnlocked, setLandsUnlocked,
    landsEnabled, setLandsEnabled,
  };
}
