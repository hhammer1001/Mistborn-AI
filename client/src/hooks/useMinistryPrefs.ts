import { useEffect, useState, useCallback } from "react";
import { BOT_TYPES, VICTORY_TYPES, type BotType, type VictoryType } from "../data/ministrySigils";

const KEY_SIGIL    = "ministry.sigil";
const KEY_FLARED   = "ministry.flared";
const KEY_FILTER   = "ministry.filter";
const KEY_BOT_CFG  = "mistborn.botConfig";

export interface BotSetupConfig {
  myChar: string;
  oppChar: string;
  botType: BotType;
  youFirst: boolean;
}

export const DEFAULT_BOT_CONFIG: BotSetupConfig = {
  myChar: "Random",
  oppChar: "Random",
  botType: "squash",
  youFirst: false,
};

export type LogMode = "all" | "bot" | "human";

export interface LogFilter {
  mode: LogMode;
  bots: BotType[];
  victories: VictoryType[];
}

export const DEFAULT_FILTER: LogFilter = {
  mode: "all",
  bots: [...BOT_TYPES],
  victories: [...VICTORY_TYPES],
};

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

export function useMinistryPrefs() {
  const [sigil, setSigilState]   = useState<string>(() => localStorage.getItem(KEY_SIGIL)  ?? "steel");
  const [flared, setFlaredState] = useState<boolean>(() => localStorage.getItem(KEY_FLARED) === "true");
  const [botConfig, setBotConfigState] = useState<BotSetupConfig>(() =>
    readJSON<BotSetupConfig>(KEY_BOT_CFG, DEFAULT_BOT_CONFIG),
  );
  const [filter, setFilterState] = useState<LogFilter>(() =>
    readJSON<LogFilter>(KEY_FILTER, DEFAULT_FILTER),
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

  // React to storage events so other tabs stay in sync.
  useEffect(() => {
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === KEY_SIGIL && ev.newValue)  setSigilState(ev.newValue);
      if (ev.key === KEY_FLARED)                setFlaredState(ev.newValue === "true");
      if (ev.key === KEY_BOT_CFG && ev.newValue) setBotConfigState(readJSON<BotSetupConfig>(KEY_BOT_CFG, DEFAULT_BOT_CONFIG));
      if (ev.key === KEY_FILTER && ev.newValue)  setFilterState(readJSON<LogFilter>(KEY_FILTER, DEFAULT_FILTER));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return {
    sigil, setSigil,
    flared, setFlared,
    botConfig, setBotConfig,
    filter, setFilter,
  };
}
