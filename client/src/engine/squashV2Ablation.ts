/**
 * squashV2Ablation.ts — Ablation harness for SquashV2 levers.
 *
 * Runs SquashV2 (going first) vs an opponent (going second) under a named
 * configuration, returning a single line "config,winrate,n,vs_opp" for easy
 * post-processing. The set of configurations is hardcoded — to add a new
 * one, edit the CONFIGS map below and re-run.
 *
 * Usage:
 *   npx tsx client/src/engine/squashV2Ablation.ts <configName> [opponent=Zoom] [games=2000] [seedOffset=1]
 *
 * configName must exist in CONFIGS.
 *
 * The harness:
 *   1. Resets SquashV2Config to defaults
 *   2. Applies the named config's overrides
 *   3. Calls recomputeSquashV2Ratings + recomputeSquashV2VsOppLifts
 *   4. Runs SquashV2-vs-opponent across all asymmetric char pairs
 *   5. Prints a CSV-friendly summary line
 *
 * Same seedOffset across all configs gives apples-to-apples comparison.
 */

import { Game, type PlayerFactory } from "./game";
import { createSquashV2Bot, SquashV2Bot } from "./squashV2Bot";
import { createZoomBot, ZoomBot } from "./zoomBot";
import { createSquashBot } from "./squashBot";
import { createTwonky } from "./bot";
import { resetCardIds } from "./card";
import {
  SquashV2Config,
  recomputeSquashV2Ratings,
  recomputeSquashV2VsOppLifts,
} from "./squashBotEval";

// ── Default config snapshot (for reset between runs) ──
// These mirror the baked-in defaults of SquashV2Config (the best-known
// config from ablation sweeps). Update both together when changing defaults.
const DEFAULT_CONFIG = {
  antiCorrelation: false,
  oppLeadAwareness: true,
  missionRewardSynergy: true,
  atiumBankingMode: "zoomCurve" as "flat" | "zoomCurve",
  buyBufferOverride: { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 } as Record<string, number>,
  selfPlayBlend: 40,
  vsOppBlend: 40,
  vsOppBlendByChar: {} as Record<string, number>,
  baselineNormalize: true,
  shanCardTunings: false,
  shanMissionMult: 1.2,
};

const DEFAULT_BOT = {
  lookaheadEnabled: true,
  lethalThreshold: 14,
  lookaheadTopK: 2,
  followupWeight: 0.6,
  lookaheadDepth: 1,
};

function resetToDefaults() {
  // Eval config
  SquashV2Config.antiCorrelation = DEFAULT_CONFIG.antiCorrelation;
  SquashV2Config.oppLeadAwareness = DEFAULT_CONFIG.oppLeadAwareness;
  SquashV2Config.missionRewardSynergy = DEFAULT_CONFIG.missionRewardSynergy;
  SquashV2Config.atiumBankingMode = DEFAULT_CONFIG.atiumBankingMode;
  SquashV2Config.buyBufferOverride = { ...DEFAULT_CONFIG.buyBufferOverride };
  SquashV2Config.selfPlayBlend = DEFAULT_CONFIG.selfPlayBlend;
  SquashV2Config.vsOppBlend = DEFAULT_CONFIG.vsOppBlend;
  SquashV2Config.vsOppBlendByChar = { ...DEFAULT_CONFIG.vsOppBlendByChar };
  SquashV2Config.baselineNormalize = DEFAULT_CONFIG.baselineNormalize;
  SquashV2Config.shanCardTunings = DEFAULT_CONFIG.shanCardTunings;
  SquashV2Config.shanMissionMult = DEFAULT_CONFIG.shanMissionMult;
  // Bot statics
  SquashV2Bot.lookaheadEnabled = DEFAULT_BOT.lookaheadEnabled;
  SquashV2Bot.lethalThreshold = DEFAULT_BOT.lethalThreshold;
  SquashV2Bot.lookaheadTopK = DEFAULT_BOT.lookaheadTopK;
  SquashV2Bot.followupWeight = DEFAULT_BOT.followupWeight;
  SquashV2Bot.lookaheadDepth = DEFAULT_BOT.lookaheadDepth;
  // Recompute (rebuilds ratings + lifts from data with current config)
  recomputeSquashV2Ratings();
  recomputeSquashV2VsOppLifts();
}

// ── Configuration matrix ──
// Each entry mutates DEFAULT state. Naming convention: {category}_{change}
// (e.g. lever_lookahead_off, hp_lookahead_K3, buf_shan_2.5).
type ConfigFn = () => void;
const CONFIGS: Record<string, ConfigFn> = {
  // Baseline = no overrides
  baseline: () => {},

  // Combine ablation winners: vs_opp_blend=120, opp_lead_off, atium_zoomcurve,
  // K=3. Each individually adds 1-2pp from baseline.
  combo_v1: () => {
    SquashV2Config.vsOppBlend = 120;
    SquashV2Config.oppLeadAwareness = false;
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Bot.lookaheadTopK = 3;
    recomputeSquashV2VsOppLifts();
  },
  // V1 + slightly higher self-play blend
  combo_v2: () => {
    SquashV2Config.vsOppBlend = 120;
    SquashV2Config.oppLeadAwareness = false;
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.selfPlayBlend = 160;
    SquashV2Bot.lookaheadTopK = 3;
    recomputeSquashV2Ratings();
    recomputeSquashV2VsOppLifts();
  },
  // V1 + per-char vs-opp blend (zoom-style boost for damage chars)
  combo_v3: () => {
    SquashV2Config.vsOppBlend = 120;
    SquashV2Config.vsOppBlendByChar = { Kelsier: 200, Vin: 160 };
    SquashV2Config.oppLeadAwareness = false;
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Bot.lookaheadTopK = 3;
    recomputeSquashV2VsOppLifts();
  },
  // K=3 + higher follow-up weight
  combo_v4: () => {
    SquashV2Config.vsOppBlend = 120;
    SquashV2Config.oppLeadAwareness = false;
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Bot.lookaheadTopK = 3;
    SquashV2Bot.followupWeight = 0.8;
    recomputeSquashV2VsOppLifts();
  },
  // Minimal: just atium_zoomcurve (the only ablation winner with rich data)
  combo_v5: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
  },
  // V5 + per-char buy buffer experiments
  combo_v5_shan35: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Shan: 3.5 };
  },
  combo_v5_shan25: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Shan: 2.5 };
  },
  combo_v5_marsh25: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Marsh: 2.5 };
  },
  // Per-character buffer sweep
  combo_v5_vin25: () => { SquashV2Config.atiumBankingMode = "zoomCurve"; SquashV2Config.buyBufferOverride = { Vin: 2.5 }; },
  combo_v5_kelsier25: () => { SquashV2Config.atiumBankingMode = "zoomCurve"; SquashV2Config.buyBufferOverride = { Kelsier: 2.5 }; },
  combo_v5_prodigy25: () => { SquashV2Config.atiumBankingMode = "zoomCurve"; SquashV2Config.buyBufferOverride = { Prodigy: 2.5 }; },
  // Combine: marsh+shan buffers
  combo_v5_marsh_shan: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Marsh: 2.5, Shan: 3.5 };
  },
  // All-char tighter buffer
  combo_v5_all25: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 2.5, Shan: 2.5, Vin: 2.5, Marsh: 2.5, Prodigy: 2.5 };
  },
  combo_v5_all20: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 2.0, Shan: 2.0, Vin: 2.0, Marsh: 2.0, Prodigy: 2.0 };
  },
  combo_v5_all30: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 3.0, Shan: 3.0, Vin: 3.0, Marsh: 3.0, Prodigy: 3.0 };
  },
  combo_v5_all35: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 3.5, Shan: 3.5, Vin: 3.5, Marsh: 3.5, Prodigy: 3.5 };
  },
  combo_v5_all40: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 4.0, Shan: 4.0, Vin: 4.0, Marsh: 4.0, Prodigy: 4.0 };
  },
  combo_v5_all50: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
  },
  combo_v5_all60: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 6.0, Shan: 6.0, Vin: 6.0, Marsh: 6.0, Prodigy: 6.0 };
  },
  combo_v5_all80: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 8.0, Shan: 8.0, Vin: 8.0, Marsh: 8.0, Prodigy: 8.0 };
  },
  combo_v5_all100: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 10.0, Shan: 10.0, Vin: 10.0, Marsh: 10.0, Prodigy: 10.0 };
  },
  // Massive buffer (essentially no buys)
  combo_v5_nobuy: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 999, Shan: 999, Vin: 999, Marsh: 999, Prodigy: 999 };
  },
  // Per-char sweet spot search — vary one at a time around 4-6
  perchar_K3_S5_V5_M5_P5: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 3.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
  },
  perchar_K7_S5_V5_M5_P5: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 7.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
  },
  perchar_K5_S3_V5_M5_P5: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 3.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
  },
  perchar_K5_S7_V5_M5_P5: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 7.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
  },
  perchar_K5_S5_V3_M5_P5: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 3.0, Marsh: 5.0, Prodigy: 5.0 };
  },
  perchar_K5_S5_V7_M5_P5: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 7.0, Marsh: 5.0, Prodigy: 5.0 };
  },
  perchar_K5_S5_V5_M3_P5: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 3.0, Prodigy: 5.0 };
  },
  perchar_K5_S5_V5_M7_P5: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 7.0, Prodigy: 5.0 };
  },
  perchar_K5_S5_V5_M5_P3: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 3.0 };
  },
  perchar_K5_S5_V5_M5_P7: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 7.0 };
  },

  // ── Shan-V2 specific (Shan is the weakest char at ~50% avg) ──
  shan_tunings_only: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.2;
  },
  shan_mission18: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = false;
    SquashV2Config.shanMissionMult = 1.8;
  },
  shan_full: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
  },
  shan_off: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = false;
    SquashV2Config.shanMissionMult = 1.2;
  },
  // More aggressive shan: higher mission mult + tighter buffer for shan
  shan_aggressive: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 7.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 2.5;
  },
  shan_loose: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 3.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
  },
  shan_mission22: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 2.2;
  },
  shan_mission30: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 3.0;
  },
  // Higher self-play blend (re-test with current data)
  shan_full_blend40: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 40;
    recomputeSquashV2Ratings();
  },
  shan_full_blend120: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 120;
    recomputeSquashV2Ratings();
  },
  shan_full_vsopp80: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.vsOppBlend = 80;
    recomputeSquashV2VsOppLifts();
  },
  shan_full_vsopp120: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.vsOppBlend = 120;
    recomputeSquashV2VsOppLifts();
  },
  // Blend sweep below 40
  shan_full_blend10: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 10;
    recomputeSquashV2Ratings();
  },
  shan_full_blend20: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 20;
    recomputeSquashV2Ratings();
  },
  shan_full_blend30: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 30;
    recomputeSquashV2Ratings();
  },
  shan_full_blend50: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 50;
    recomputeSquashV2Ratings();
  },
  shan_full_blend0: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 0;
    recomputeSquashV2Ratings();
  },
  // Combine blend40 + vsopp variations
  shan_full_b40_vsopp20: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Config.vsOppBlend = 20;
    recomputeSquashV2Ratings();
    recomputeSquashV2VsOppLifts();
  },
  shan_full_b40_vsopp60: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Config.vsOppBlend = 60;
    recomputeSquashV2Ratings();
    recomputeSquashV2VsOppLifts();
  },
  // Best config so far: shan_full + blend=40
  best: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 40;
    recomputeSquashV2Ratings();
  },
  // best minus Shan card tunings (Shan-only sweep showed cardTunings hurts -0.5pp)
  best_no_shan_cards: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = false;
    SquashV2Config.shanMissionMult = 1.2;
    SquashV2Config.selfPlayBlend = 40;
    recomputeSquashV2Ratings();
  },
  // best + 2-ply lookahead
  best_2ply: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = false;
    SquashV2Config.shanMissionMult = 1.2;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Bot.lookaheadDepth = 2;
    recomputeSquashV2Ratings();
  },
  // best + 2-ply + K=3
  best_2ply_K3: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = false;
    SquashV2Config.shanMissionMult = 1.2;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Bot.lookaheadTopK = 3;
    SquashV2Bot.lookaheadDepth = 2;
    recomputeSquashV2Ratings();
  },
  // K sweeps with best_no_shan_cards baseline
  best_K1: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = false;
    SquashV2Config.shanMissionMult = 1.2;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Bot.lookaheadTopK = 1;
    recomputeSquashV2Ratings();
  },
  best_K3_v2: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = false;
    SquashV2Config.shanMissionMult = 1.2;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Bot.lookaheadTopK = 3;
    recomputeSquashV2Ratings();
  },
  best_K5: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = false;
    SquashV2Config.shanMissionMult = 1.2;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Bot.lookaheadTopK = 5;
    recomputeSquashV2Ratings();
  },
  best_fw04: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = false;
    SquashV2Config.shanMissionMult = 1.2;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Bot.followupWeight = 0.4;
    recomputeSquashV2Ratings();
  },
  best_fw08: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = false;
    SquashV2Config.shanMissionMult = 1.2;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Bot.followupWeight = 0.8;
    recomputeSquashV2Ratings();
  },
  best_fw10: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = false;
    SquashV2Config.shanMissionMult = 1.2;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Bot.followupWeight = 1.0;
    recomputeSquashV2Ratings();
  },
  // Best + per-char blend (similar to zoom's Kelsier: 120, Vin: 100)
  best_perchar_blend: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Config.vsOppBlendByChar = { Kelsier: 120, Vin: 100 };
    recomputeSquashV2Ratings();
    recomputeSquashV2VsOppLifts();
  },
  // Best + lookahead K=3
  best_K3: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Bot.lookaheadTopK = 3;
    recomputeSquashV2Ratings();
  },
  // Best + anti-correlation
  best_anti_corr: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Config.antiCorrelation = true;
    recomputeSquashV2Ratings();
  },
  // Best + opp-lead off
  best_opplead_off: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Config.oppLeadAwareness = false;
    recomputeSquashV2Ratings();
  },
  // Best + synergy off
  best_synergy_off: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
    SquashV2Config.buyBufferOverride = { Kelsier: 5.0, Shan: 5.0, Vin: 5.0, Marsh: 5.0, Prodigy: 5.0 };
    SquashV2Config.shanCardTunings = true;
    SquashV2Config.shanMissionMult = 1.8;
    SquashV2Config.selfPlayBlend = 40;
    SquashV2Config.missionRewardSynergy = false;
    recomputeSquashV2Ratings();
  },

  // ── Levers (each disabled individually from baseline) ──
  lever_lookahead_off: () => {
    SquashV2Bot.lookaheadEnabled = false;
  },
  lever_lethal_off: () => {
    SquashV2Bot.lethalThreshold = -1;
  },
  lever_synergy_off: () => {
    SquashV2Config.missionRewardSynergy = false;
  },
  lever_opp_lead_off: () => {
    SquashV2Config.oppLeadAwareness = false;
  },
  lever_per_opp_off: () => {
    SquashV2Config.vsOppBlend = 0;
    SquashV2Config.vsOppBlendByChar = {};
    recomputeSquashV2VsOppLifts();
  },
  lever_baseline_norm_off: () => {
    SquashV2Config.baselineNormalize = false;
    recomputeSquashV2Ratings();
  },

  // ── Levers (default-off enabled to test) ──
  lever_anti_corr_on: () => {
    SquashV2Config.antiCorrelation = true;
  },
  lever_atium_zoomcurve: () => {
    SquashV2Config.atiumBankingMode = "zoomCurve";
  },

  // ── Self-play blend sweep ──
  hp_blend_40: () => { SquashV2Config.selfPlayBlend = 40; recomputeSquashV2Ratings(); },
  hp_blend_60: () => { SquashV2Config.selfPlayBlend = 60; recomputeSquashV2Ratings(); },
  hp_blend_100: () => { SquashV2Config.selfPlayBlend = 100; recomputeSquashV2Ratings(); },
  hp_blend_120: () => { SquashV2Config.selfPlayBlend = 120; recomputeSquashV2Ratings(); },
  hp_blend_160: () => { SquashV2Config.selfPlayBlend = 160; recomputeSquashV2Ratings(); },

  // ── Per-opp blend sweep ──
  hp_vsopp_20: () => { SquashV2Config.vsOppBlend = 20; recomputeSquashV2VsOppLifts(); },
  hp_vsopp_60: () => { SquashV2Config.vsOppBlend = 60; recomputeSquashV2VsOppLifts(); },
  hp_vsopp_80: () => { SquashV2Config.vsOppBlend = 80; recomputeSquashV2VsOppLifts(); },
  hp_vsopp_100: () => { SquashV2Config.vsOppBlend = 100; recomputeSquashV2VsOppLifts(); },
  hp_vsopp_120: () => { SquashV2Config.vsOppBlend = 120; recomputeSquashV2VsOppLifts(); },

  // ── Per-char vsOpp blend (zoom-style boost for damage chars) ──
  hp_vsopp_kelsier_high: () => {
    SquashV2Config.vsOppBlendByChar = { Kelsier: 120 };
    recomputeSquashV2VsOppLifts();
  },
  hp_vsopp_kelsier_vin_high: () => {
    SquashV2Config.vsOppBlendByChar = { Kelsier: 120, Vin: 100 };
    recomputeSquashV2VsOppLifts();
  },

  // ── Lookahead K sweep ──
  hp_K1: () => { SquashV2Bot.lookaheadTopK = 1; },
  hp_K3: () => { SquashV2Bot.lookaheadTopK = 3; },
  hp_K4: () => { SquashV2Bot.lookaheadTopK = 4; },

  // ── Followup weight sweep ──
  hp_fw_04: () => { SquashV2Bot.followupWeight = 0.4; },
  hp_fw_05: () => { SquashV2Bot.followupWeight = 0.5; },
  hp_fw_07: () => { SquashV2Bot.followupWeight = 0.7; },
  hp_fw_08: () => { SquashV2Bot.followupWeight = 0.8; },

  // ── Buy buffer per-char (test if any benefit from override like Shan-zoom) ──
  buf_shan_25: () => { SquashV2Config.buyBufferOverride = { Shan: 2.5 }; },
  buf_shan_35: () => { SquashV2Config.buyBufferOverride = { Shan: 3.5 }; },
  buf_marsh_25: () => { SquashV2Config.buyBufferOverride = { Marsh: 2.5 }; },
  buf_kelsier_20: () => { SquashV2Config.buyBufferOverride = { Kelsier: 2.0 }; },
};

// ── Bench runner ──

function bench(opponent: string, numGamesPerMatchup: number, seedOffset: number) {
  const chars = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"];
  const factories: Record<string, PlayerFactory> = {
    Zoom: createZoomBot as PlayerFactory,
    Squash: createSquashBot as PlayerFactory,
    V1: createTwonky as PlayerFactory,
  };
  const fOpp = factories[opponent];
  if (!fOpp) throw new Error(`Unknown opponent ${opponent}`);
  const fFirst = createSquashV2Bot as PlayerFactory;

  let wins = 0, total = 0;
  let matchupIdx = 0;
  const tStart = Date.now();
  for (const cFirst of chars) {
    for (const cSecond of chars) {
      if (cFirst === cSecond) continue;
      const tM = Date.now();
      for (let i = 0; i < numGamesPerMatchup; i++) {
        try {
          resetCardIds();
          const seed = seedOffset + matchupIdx * 1000003 + i;
          const tG = Date.now();
          const game = new Game({
            playerFactories: [fFirst, fOpp],
            names: ["V2", opponent],
            chars: [cFirst, cSecond],
            seed,
          });
          const winner = game.play();
          const gMs = Date.now() - tG;
          if (gMs > 1000) {
            // SLOW game — log to stderr (not stdout, which is the CSV channel)
            process.stderr.write(`SLOW: ${cFirst}-vs-${cSecond} seed=${seed} ${gMs}ms turns=${game.turncount}\n`);
          }
          total++;
          if (winner.name === "V2") wins++;
        } catch (e) {
          process.stderr.write(`CRASH ${cFirst}-vs-${cSecond} seed=${seedOffset + matchupIdx * 1000003 + i}: ${e}\n`);
        }
      }
      const dt = ((Date.now() - tM) / 1000).toFixed(2);
      const elapsed = ((Date.now() - tStart) / 1000).toFixed(0);
      process.stderr.write(`  [${elapsed}s] ${cFirst} vs ${cSecond}: ${dt}s\n`);
      matchupIdx++;
    }
  }
  return { wins, total, pct: total > 0 ? (100 * wins / total) : 0 };
}

// ── CLI ──

const configName = process.argv[2];
const opponent = process.argv[3] ?? "Zoom";
const games = parseInt(process.argv[4] ?? "2000", 10);
const seedOffset = parseInt(process.argv[5] ?? "1", 10);

if (!configName || !(configName in CONFIGS)) {
  console.error(`Unknown config "${configName}". Known configs:`);
  for (const k of Object.keys(CONFIGS)) console.error(`  ${k}`);
  process.exit(1);
}

// Disable training-time toggle (we want runtime lookahead in benches)
ZoomBot.lookaheadEnabled = true;

resetToDefaults();
CONFIGS[configName]();

const startTime = Date.now();
const result = bench(opponent, games, seedOffset);
const elapsedSec = (Date.now() - startTime) / 1000;

// CSV: config, opp, games, wins, total, winrate_pct, elapsed_sec, seedOffset
console.log(
  `${configName},${opponent},${games},${result.wins},${result.total},${result.pct.toFixed(2)},${elapsedSec.toFixed(1)},${seedOffset}`,
);
