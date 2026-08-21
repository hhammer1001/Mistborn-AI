# Squash & Zoom — Tuning Notes

Notes from iterating on Squash Bot (originally named TwonkyV2) against the original Twonky. Squash ceiling: **73.7%** win rate over 5000 games. Zoom is a going-second specialist built on the same architecture — see the **Zoom** section at the bottom.

## Architecture

- **`bot.ts`** — Twonky original: priority-waterfall bot using pre-computed win-rate correlations from Twonky self-play (`data/*3.json` files)
- **`squashBot.ts`** — Squash: action-scoring bot. Scores every available action, picks the max
- **`squashBotEval.ts`** — evaluation engine: resource values, context weights, snapshot builder, analytical card ratings, self-play blending
- **`selfplay.ts`** — mirror-matchup data collector (Squash vs Squash, same character both sides)
- **`data/squash_weights/*.json`** — per-character self-play correlation data

The Squash rating for a card is:

```
finalRating = analyticalRating                          // formula-based
            + charMetalBonus (0 / 0.1 / 0.25)           // same metal / same pair / match
            + selfPlayWinRate * SELFPLAY_BLEND_STRENGTH // empirical signal
```

Then dynamic adjustments layer on top (heal context, damage context, eliminate context, etc.) producing `dynamicCardRating`.

## Progress Journey

| Stage | Win rate | Notes |
|---|---|---|
| Squash initial | 0.8% | Bot literally refused to burn cards (bug in metalUnlockValue counting the burned card as its own target) |
| Fixed opportunity-cost formula | 28.5% | Bot started actually activating cards |
| Tuned missions + buy scoring | 46.2% | Closer to parity with Twonky |
| Added Squash self-play data | 48.2% | Replaced correlation data from bad bot |
| Blend=20 | 61.9% | Self-play signal dominates analytical |
| Defender bonus + heal weight + buy tuning | 70.3% | Major formula fixes |
| 30k-game self-play + blend=100 | 73.7% | Plateau — tuning saturated |

## What Worked

### 1. First-principles resource values (biggest foundation)

Instead of learning card values from Twonky's self-play (which is biased by Twonky's play style), assign analytical values to effect types based on the game economy:

```
D (damage)      = 1.0
M (money)       = 1.0
Mi (mission)    = 2.2   (primary win condition)
H (heal)        = 0.5
C (draw)        = 2.5
T (training)    = 3.0
E (eliminate)   = 2.0
A (atium)       = 2.5
B (extra burn)  = 3.5
K (kill ally)   = 3.0
R (refresh)     = 1.5
Pc (perm draw)  = 10.0  (+1 card every turn forever)
Pd (perm dmg)   = 8.0
Pm (perm money) = 7.0
pull            = 1.5
push            = 1.0
riot            = 2.5
seek(N)         = N * 0.8
```

### 2. Context-sensitive effect weights (+large gains baked in)

Weights multiply/add based on game state:
- **Damage**: +1.5 if opp ≤ 15 HP, +3.0 if opp ≤ 8 HP, *0.7 if opp has defenders, *1.3 on damage path
- **Heal**: 0.2 if HP ≥ 38, 3.0 if HP ≤ 12, *1.3 if opp outpacing us
- **Mission**: *2.2*1.3 base, *1.5 on mission path, *0.7 on damage path, *1.8 if 2 missions complete
- **Training**: 5.0 if 1 away from unlock, 3.5 if 2 away
- **Draw**: 3.0 early game, 2.0 otherwise
- **Eliminate**: 3.0 if deck ≥ 15 cards, 0.5 if deck ≤ 8

### 3. Self-play data (biggest single lever: +10% from 48% to 62%)

Mirror matchups (same char both sides) strip out character-vs-character variance. 30k games/character produces clean correlation data. The data corrected three systematic errors in analytical ratings:

- **Over-valued** money cards (Inspire, Intimidate, Charm)
- **Over-valued** conditional effects (Investigate's "special1" often triggers for 0)
- **Under-valued** mission engines (Pursue, Pierce, Unveil, Hyperaware)

Blend is **additive**: `rating += winRate * 100`. Blend strength 100 gives best stability; ranges 40-200 all plateau 72-75%.

### 4. Defender bonus (+3.3%)

Hazekillers/Soldier/Pewterarm were rated near 0 because my ally formula didn't account for damage blocking:

```
defenderBonus = defenseType === "D" ? health * 4.0 : 0
totalAllyValue += defenderBonus
```

A defender with 3 HP blocks roughly 3 damage per turn it's alive — massive equivalent value. Squash now buys Hazekillers/Pewterarm when needed, reducing losses to damage-oriented opponents.

### 5. Heal weight becomes preventive (+1%)

Healing is now boosted when opponent is outpacing us in damage pressure, not just when we're low:

```
healWeight = basedOnHP (0.2 to 3.0)
         * (1.3 if myHealthDeficit > oppDmgPressure else 1.0)
```

### 6. Buy multiplier lowered from 6 to 2 (+2.5%)

The buy score was over-inflated, causing Squash to buy too many mediocre cards. Lowering `rating * 6` to `rating * 2` made buying less attractive relative to using metals, advancing missions, and activating ally abilities.

### 7. Seek weight doubled (0.4 → 0.8, +1%)

Seek lets you use a market card's tier-1 ability for free — this was undervalued in analytical ratings. Self-play confirmed by strongly rating Pierce and Unveil (both have seek).

### 8a. Eliminate weak allies when deck is bloated (+1%)

Previously `eliminateIn` had a blanket `!(c.card instanceof Ally)` filter — allies were never candidates. But weak allies (Keeper -16.8%, Rebel for Shan -47.1%, etc.) cycle uselessly through hand→discard→deck. Now allies below buffer rating are eliminable IFF deck size ≥ 12 (so we clear Funding first, only trim weak allies when we can spare the slot).

### 8b. Keep eliminate valuable at mid-lean deck sizes (+0.5%)

Previous tiering dropped eliminate weight to 0.5 at deck ≤ 8. This stopped the bot from pushing decks from 9→8 even when Funding was still present. Tightened the curve: 3.0 at ≥15, 2.0 at ≥10, 1.5 at ≥8, 0.5 below.

### 9. Dynamic buy buffer (per-character base + game-phase adjustments)

```
BASE_BUFFERS = Kelsier 1.5, Marsh 1.8, Shan 1.7, Vin 1.5, Prodigy 1.4
- 0.3 early game (build engine aggressively)
- 0.2 if curMoney ≥ 8 (spend it or waste it)
+ 0.4 late game (deck is full, be selective)
+ 0.3 if deckSize ≥ 15
+ 0.5 if deckSize ≥ 18 (severe bloat penalty)
```

## What Didn't Work

### Things tested and rejected

1. **Epsilon-greedy exploration in self-play** (ε=0.2, picks random top-5 action occasionally)
   - Hurt to 68.6% from 70.6%. Adding noise to training data makes the bot learn suboptimal patterns. The correlation signal weakens when action choice isn't determined by the scoring function.

2. **Multi-iteration self-play** (regenerate data 3 times, each using latest weights)
   - Oscillated wildly: 61.4%, 73.8%, 60.0%. When regen runs with `SELFPLAY_BLEND_STRENGTH > 0`, the bot biases data toward the previous iteration's signal, creating feedback loops. Must regen with blend=0 for stable bootstrapping.

3. **Confidence-weighted blending** (`adjust *= min(samples/1000, 1.0)`)
   - Dropped to 72.1%. Discounted well-sampled card signals below the 1000-sample threshold, hurting more than it helped for rare-but-legitimate cards.

4. **Save-for-6-cost heuristic** (penalize filler buys when a strong 6-cost is available)
   - Went to 59.3% from 61.9%. The self-play weights already encode "buy Pierce, don't buy Strike." Adding a hand-tuned rule on top distorted a well-calibrated signal.

5. **Multi-tier opportunity cost for burn_card** (weight all remaining tiers, not just next)
   - Slight drop. The bot became too reluctant to burn cards, even when ending turn otherwise. Simple next-tier formula wins.

6. **Pull/push/riot base values boosted** (1.5→2.5, 1.0→1.5, 2.5→3.5)
   - Slight drop. These effects are already captured in dynamic weights and self-play.

7. **Atium/burn weight boost** (A: 2.5→4.0, B: 3.5→4.5)
   - No change. Self-play data already accounts for these.

8. **Mission spreading bonus** (bonus for advancing an unprogressed mission IF another mission is at 5+)
   - Mixed. Settled on a simple +10 for any unprogressed mission instead.

9. **Char-metal synergy bonus increased** (0.25 → 1.0)
   - Dropped to 72.7%. Self-play already captures this differentiation.

10. **Damage path multiplier increased** (1.3 → 1.5)
    - No meaningful change.

11. **More aggressive mission-damage flip threshold** (0.3 → 0.15)
    - No meaningful change.

12. **Ally bonus scaled with health** (`3 + health*2` instead of flat 5)
    - Dropped to 72.5%.

13. **Mission weight base boost** (1.3 → 1.5)
    - No change.

14. **Training weight curve tweaks** (1-gap 5→6, 2-gap 3.5→4)
    - No change.

## Known Weaknesses

1. **Shan vs Marsh**: 48% — structurally hard. Marsh's +1 Mi/turn char ability creates a mission race Shan can't win without damage engine cards, and the Twonky-Marsh build is already well-tuned for mission.

2. **Bots plateau at 74%**: Can't break through without lookahead. Twonky's rigid "missions first always" priority is genuinely optimal for the scenarios where it applies, and Squash's single-step scoring can't plan around it.

3. **Sample-selection bias in self-play**: Cards that start rated below the buy buffer (like Obligator, rated 0.84 analytical) never get bought, so self-play has no data, so the rating never improves. A few cards are stuck in this loop. Could be solved with exploration but exploration hurts data quality.

4. **Damage victories outnumber mission victories** (2790 D / 2149 M at 5000 games). Squash is supposed to default to mission path, but ends up winning by damage more often because it pivots when falling behind in mission races. This is correct (damage is the fallback) but suggests Squash isn't racing missions aggressively enough.

## Key Tuning Constants

In `squashBotEval.ts`:
```
SELFPLAY_MIN_SAMPLES = 100          // skip weights with < 100 samples
SELFPLAY_BLEND_STRENGTH = 100.0     // additive blend: winRate × this
Defender bonus = health * 4.0       // for cards with defenseType="D"
Mi base weight = 2.2 (* 1.3 in missionWeight)
```

In `squashBot.ts`:
```
scoreBuy: rating * 2 * phaseMult + allyBonus - deckPenalty
deckPenalty: max(0, (deckSize - 10) * 2.5)
scoreBurnMetal: metalVal - 0.5
scoreFlare: metalVal - 1.5
scoreUseMetal: 30 + effectValue
scoreAllyAbility: 40 + effectValue
scoreCharAbility1/3: 35 + effectValue
scoreMissionAdvance: 70 base + proximity/race/victory-path modifiers
```

## Bot-vs-Bot Flow

**Important**: `Game.play()` calls `Player.playTurn()` which must mirror the per-turn setup that `session.ts` does via `_startNextTurn` + `_playPending`. If they drift, benchmarks will silently disagree with real play.

Per-turn sequence (must match between `Player.playTurn` and `session._startNextTurn` + `_runBotTurn`):

1. `curMoney = pMoney` (permanent money bonus)
2. `curDamage = pDamage` (permanent damage bonus)
3. `playPending()` — allies pending in hand move to zone + run `play()` (Noble → +burn, Crewleader → +handSize, Smoker → smoking); funding pending in hand runs `play()` for +1 money
4. `resolve("T", "1")` — training +1
5. `takeActions` — bot's action loop
6. `assignDamage` — allocate `curDamage` to kill opp allies
7. `game.attack` — send leftover `curDamage` to opp
8. `curDamage = 0` (pDamage re-applies at start of next turn)

`end_actions` triggers `cleanUp` which draws the next hand with `{ deferred: true }`. Allies and funding drawn this way are marked `pending: true` and stay in the hand until the owner's next turn start processes them via step 3 above.

**Historical gotcha**: commit `8ea376a` deferred ally/funding play from end-of-turn to start-of-next-turn but only updated `session.ts`. `Player.playTurn` was missed, so bot-vs-bot games silently had allies stuck in hand forever (never entering the ally zone, never running `play()`). Squash's win rate dropped ~20% until this was noticed and fixed.

## Self-Play Pipeline

```
# 1. Disable blend to get analytical-only self-play
SELFPLAY_BLEND_STRENGTH = 0.0

# 2. Run mirror matchups (same char both sides, eliminates character variance)
npx tsx client/src/engine/selfplay.ts 30000

# 3. Re-enable blend
SELFPLAY_BLEND_STRENGTH = 100.0

# 4. Benchmark
npx tsx client/src/engine/benchmark.ts 200
```

**Critical rule**: regen self-play data with `SELFPLAY_BLEND_STRENGTH = 0`. Otherwise the bot biases data toward previous iteration's signal, creating feedback loops.

## Ideas for Future (Structural Changes)

Not attempted — these require actual architectural additions, not just tuning:

1. **1-ply lookahead**: simulate each action and score the resulting state. Probably +5-10%. Cost: ~10× slower evaluation.

2. **MCTS with rollouts**: proper search with random rollouts to end-of-game. Probably +10-15%. Cost: ~100× slower.

3. **Opponent modeling**: track opponent's character and apply opponent-specific strategy (e.g., aggressive vs Marsh, defensive vs Kelsier). Probably +3-5%.

4. **Per-character strategy profiles**: hand-write specific buy priorities / action preferences per character. Probably +2-5% but brittle.

5. **Neural network value function**: train a small NN on (state, action, outcome) tuples from self-play. Could match or exceed hand-tuned formulas. Expensive to set up.

## Scripts

```bash
# Benchmark Squash vs Twonky (default 20 games/matchup, 5 chars × 4 opponents = 20 matchups)
npx tsx client/src/engine/benchmark.ts [gamesPerMatchup]

# Baseline sanity check: Twonky vs Twonky should be ~50%
npx tsx client/src/engine/benchmark.ts baseline 100

# Regenerate self-play data
npx tsx client/src/engine/selfplay.ts [gamesPerChar] [outputDir] [explorationRate]
```

# Zoom — Going-Second Specialist

Zoom is a sibling of Squash that shares the entire scoring/eval pipeline but trains on a different data corpus: mirror games where **only the second-player seat is recorded**. The aim is a bot that handles the tempo deficit of going second better than Squash (whose mirror data averages both seats).

## Architecture

- **`zoomBot.ts`** — `class ZoomBot extends SquashBot` overriding `evalProfile = "zoom"`. Same scoring code, different data lookups.
- **`squashBotEval.ts`** — refactored to be profile-aware. `BotProfile = "squash" | "zoom"` is exported. `buildSnapshot`, `dynamicCardRating`, `timingPhaseAdjust` switch on `snap.profile` to select between `data/squash_*/` and `data/zoom_*/`.
- **`selfplayZoom.ts`** — Zoom-vs-Zoom mirrors but records only seat 1 (turnOrder=1) outcomes per game.
- **`data/zoom_weights/*.json`**, **`data/zoom_timing/*.json`** — second-player-only correlation data.

## Methodology twists vs Squash

1. **Single-seat training**: Squash records both seats per game (2× sample efficiency for seat-symmetric data); Zoom records only seat 2.
2. **Baseline-normalized blend**: Squash's mirror data is centered on a winrate of ~0 (each seat wins ~half). Zoom's seat-2-only data is centered on the seat-2 disadvantage (e.g. Kelsier seat 2 wins only ~25% of mirrors → baseline = −0.50). Without normalization the additive blend `winRate × 80` would penalize every Kelsier card by ~−40 points uniformly. Fix in `computeAllRatings`: when `baselineNormalize=true`, subtract the per-character weighted-average winrate before applying the blend, so the signal becomes each card's *lift* over baseline. Squash skips this (its baseline ≈ 0 and subtracting would shift its tuned buy thresholds). Zoom enables it.

## Training Journey (vs V1, going second)

| Self-play volume per char | + Timing per char | Zoom 2nd vs V1 | Squash 2nd vs V1 (same run) |
|---|---|---|---|
| 0 (empty stubs) | 0 | 57.0% | n/a |
| 5k | 0 | 59.0% | n/a |
| 20k | 0 | 60.0% | n/a |
| 50k | 0 | 67.2% | 69.0% |
| 50k | 30k | 71.0% | 72.7% |
| **100k** | **50k (matched)** | **66.5%** (n=1000) | **65.4%** (n=1000) |

At equal sample density (Zoom seat-2-only ≈ Squash both-seats), **Zoom matches Squash in the seat-2 role** (66.5% vs 65.4%, gap within σ=1.5pp at n=1000) — methodology validated. Smaller benchmarks (n=600) showed 5-7pp run-to-run variance, so reading single small benches as "Zoom -2pp behind" was sampling noise.

Zoom-vs-Squash (Zoom going second, Squash going first) at the final state: **33.1%** — Squash's first-seat advantage is real and not yet overcome by Zoom's seat-2 specialization.

## Key code

In `squashBotEval.ts`:
```
SELFPLAY_BLEND_STRENGTH = 80          // shared across profiles for now
TIMING_BLEND_STRENGTH_DEFAULT = 20    // shared
SELFPLAY_MIN_SAMPLES = 100
TIMING_MIN_SAMPLES = 50
baselineNormalize:                    // computeAllRatings flag
  squash → false (preserves tuning)
  zoom   → true  (handles seat-2 asymmetry)
```

## Findings

1. **Lift range parity**: per-character lift ranges (after baseline normalization) for Zoom data have nearly identical σ (≈12-15) to Squash's raw winrate signal — so the shared `SELFPLAY_BLEND_STRENGTH = 80` is correctly tuned for both. Per-profile blend strength is **not** needed.
2. **Lockstep training is required**: self-play and timing data must be trained against the same bot snapshot. Training 100k self-play after 30k timing regressed Zoom 71% → 64.8% — timing baselines went stale. Always retrain timing immediately after self-play.
3. **Volume to plateau**: Squash uses 30k self-play × 2 seats = 60k records/char + 10k timing × 2 = 20k records/char. Zoom needs 100k × 1 = 100k self-play records/char and 50k × 1 = 50k timing records/char to reach parity — about 5× the wall-clock training time per snapshot for the same per-record signal density.
4. **Random-character mirror** (Zoom-A seat 2 vs Zoom-B seat 1): +1pp lift over same-char mirror. Diversifies opp behavior without survivorship bias.
5. **Commitment > accuracy**: dynamic strategy detection (mid-game pivot based on opp's actual progress) regressed vs static character-prior. Strategy dithering across turns hurts more than mid-game accuracy helps.

## Anti-correlation: the seat-2 strategic shift

Biggest single design lever: **anti-correlate Zoom's victory path with opp's**. Squash defaults damage for Kelsier and mission for everyone else; Zoom seat 2 plays the orthogonal axis so the two bots aren't competing on the same race (where seat 1 wins via tempo).

```ts
if (profile === "zoom" && player.turnOrder === 1) {
  if (oppIsKelsier) victoryPath = "mission";
  else if (isKelsier || hasDamageEngine) victoryPath = "damage";
  // else: non-Kelsier zoom without damage tools — accept the race
}
```

Lifts Zoom-vs-Squash from baseline 32-33% to ~34-37% range (n=1000 has σ≈1.5pp; observed individual benches 32-38%). Per-matchup: Kelsier-1st matchups especially improve (Zoom-Marsh-vs-Kelsier 22%→54%, Zoom-Shan-vs-Kelsier 62%→74%) because Zoom races mission while Squash-Kelsier races damage on a separate axis.

## Failed experiments

All retrained with full lockstep timing + 1000-game benchmarks. Methodology is sound; ideas were wrong.

| Experiment | Result | Why it failed |
|---|---|---|
| Asymmetric training (Squash 1st vs Zoom 2nd) | 28.5% | 75% loss rate crushes signal-to-noise |
| Mixed-source training (50% mirror + 50% asym) | 32.4% | Asymmetric games introduce noise that dominates |
| Runtime variance (15% top-3 random) | 22.4% | Random plays hurt EV strictly |
| Forced damage commitment (zoom seat 2 always damage) | 20.9% | Forces damage on chars without damage tools |
| Mission/damage weight amplification (×1.4 / ×1.3) | 35.2% | Half-measures actually win some games |
| Targeted amplification (only when opp = Kelsier) | 34.3% | Local lift in Kelsier matchups, losses elsewhere |
| Dynamic anti-correlation (mid-game pivot) | 32.7% | Strategy dithering — commitment > accuracy |
| Denial buying (factor opp's char rating into buys) | 28.8% | Zoom buys cards it doesn't need, polluting deck |
| Mission-set awareness (heal/defender shifts) | 32-32.4% | Heuristic effects tangled with self-play data calibration |
| Seat-2 mission-tier heuristics | hurt vs V1 | Distorts already-tuned mission scoring |
| Naive 1-ply state-value lookahead | 0.5% | State-value scale too small; Zoom never picked end_actions |
| Turn-rollout lookahead (greedy heuristic to end-of-turn) | 23.7% | Heuristic-greedy rollout doesn't predict actual lookahead play |
| Training data with lookahead enabled | 32.6% | Lookahead picks distort card-value signal in self-play |

## Heuristic-chain lookahead + lethal solver (kept)

Two architectural levers added on top of anti-correlation, informed by [BOT_RESEARCH.md](BOT_RESEARCH.md) survey of card-game AI literature.

**1-ply heuristic-chain lookahead.** For each top-K candidate, snapshot game → `performAction` → compute heuristic-best-followup score → restore. Action value = `heuristic + 0.8 × followup-heuristic`. Captures "X enables Y" effects (e.g. burning a metal that unlocks a tier-3 ability worth 50) that single-step heuristic scoring misses. State-cloning via [gameSnapshot.ts](gameSnapshot.ts) (extracted from session.ts).

**Lethal solver.** When opp HP ≤ 12, before normal action selection, run a greedy depth search over damage-producing actions per top-level branch. If accumulated damage would kill opp (after defenders), return that branch's first action. Mirrors the chess endgame-solver / Hearthstone lethal-calc pattern from research doc.

3-run bench (n=1000 each, σ ≈ 1.5pp):

| Configuration | Zoom 2nd vs Squash 1st |
|---|---|
| No lookahead (heuristic only) | 35.0%, 35.9%, 33.8% → **avg 34.9%** |
| Chain lookahead only | 36.8%, 35.3%, 34.0% → **avg 35.4%** |
| **Chain lookahead + lethal solver** | 34.1%, 37.3%, 36.6% → **avg 36.0%** |

Combined lift: **~+1.1pp** over heuristic-only. Within noise on individual runs but consistent across averages.

Also: **Zoom vs V1 going second: 68.8%** (was 65% before lookahead).

Cost: ~2× slower at runtime. K=8 lookahead candidates, lethal solver triggers ~5% of action choices.

## ⚠️ Earlier "51.54%" claim was a bug — corrected

The session briefly claimed 51.54% vs Squash. This was wrong. The mission-reward synergy boosts were applied to BOTH `snap.profile === "squash"` and `"zoom"` — not gated. The aggressive boost values (cap=3 +30, etc.) shifted Squash's eval without retraining its weights, pushing Squash off its tuned plateau. Zoom appeared to win because Squash was accidentally weakened.

When the synergy was correctly gated to `snap.profile === "zoom"` only, Zoom's win rate dropped to 25-27%. The aggressive boosts were also actively harmful for Zoom alone.

**Honest final state with synergy gated to zoom + small boost values + blend=40**:

| Matchup | Win rate (n=10000 seeded) |
|---|---|
| Zoom 2nd vs Squash 1st | **38.88%** |
| Zoom 2nd vs V1 1st | 72.3% |

This is the legitimate session improvement: ~33% baseline → **~39%** vs Squash, ~65% baseline → **72%** vs V1.

**Genuine session lifts**:
- Anti-correlation: +3pp (proven)
- Chain lookahead at K=3 + lethal solver: +3pp (proven via ablation: 34.2% without → 37.8% with)
- Per-opp targeted training (5 weight sets): +1pp
- Small T/A mission-reward synergy (gated): +0.6pp (proven via ablation)
- Per-mission opp-lead awareness: +0.7pp (proven via ablation)
- Tuning (K=8 → K=3, blend tuning): +1pp

Total honest lift: **~+6pp** (33% → 39% vs Squash). Half of what was earlier claimed.

**Failed experiments (also honest)**:
- Aggressive synergy boost values (when correctly gated to zoom only): regressed to 25-27%
- Expanded synergies (D/Pc/C/R/E/K/M): regressed
- Higher per-opp blend strength (>40): regressed
- 2-step chain lookahead: regressed (33%)

**The lesson**: heuristic changes that affect both bots in a profile-aware codebase MUST be gated by profile, otherwise they look like Zoom improvements when they're really just Squash regressions.

## 42% target reached (with seeded benchmarking)

After threading deterministic seed-based RNG through the engine, benchmarks became reproducible across runs with same seed-range. Earlier "40% avg" results turned out to be favorable variance from non-seeded sampling — true mean with original config was ~37%.

The breakthrough: **massive aggressive boost values for the mission-reward synergy.** The boost is so large that cards with capacity≥2 + atium-using cards become near-mandatory buys when a T or A reward mission is in play (60-70% of games). Cap=3 cards (Pierce, Unveil, Pursue, Hyperaware, Strategize) get +30 to their rating — more than 5× their base value.

**Final 5-seed-range bench (n=10000 total, deterministic seeds):**

| Seed range | Win rate |
|---|---|
| 0–100k | 43.3% |
| 100k–200k | 42.0% |
| 200k–300k | 42.8% |
| 300k–400k | 41.1% |
| 400k–500k | 42.4% |
| **Avg** | **42.33%** |

vs V1 sanity: **67.8%** (down ~3pp from 71% — trade-off for the Squash gains).

### Tuning journey (with seeded n=10000 benches)

| Lever | Result vs Squash 1st |
|---|---|
| Heuristic only (no lookahead) | 34.2% |
| + 1-ply chain lookahead at K=8 followup=0.8 | 37.78% |
| Tuned blend=40 (was 80) | 38.7% |
| Tuned K=3 (was 8) | 39.06% |
| T/A synergy boost 1.0/2.0/1.2 | 39.6% |
| T/A synergy boost 5.0/10.0/5.5 | 41.5% |
| **T/A synergy boost 15/30/18** | **42.33%** |
| T/A synergy boost 30/60/35 (too far) | 41.5% |

Key: capacity=3 cards (mission engines) get +30 only when missions grant T (training) or A (atium) — accelerates training thresholds, making tier-3 abilities accessible faster.

### Layer ablations (each disabled independently from final config)

| Layer disabled | Δ from baseline |
|---|---|
| Per-mission opp-lead awareness | −0.7pp |
| Mission-reward synergy (T/A) | −0.6pp |
| Deck-composition signals | ~0pp (neutral) |

The breakthrough came from compounding several layers, none of which alone exceeded baseline by more than ~1pp:

| Layer | Cumulative avg vs Squash |
|---|---|
| Baseline mirror anti-correlation | ~33% |
| + 1-ply chain lookahead + lethal solver | ~36% |
| + Per-opp-character training (5 oppChar weight sets, 200k games each) | ~38% |
| + Deck-composition signals (override anti-corr if my deck has clear engine bias) | ~38% (neutral, kept) |
| + Per-mission opp-lead awareness (skip mission races opp dominates) | ~38% (neutral, kept) |
| + Mission-reward synergy (T/A reward → boost cap=2/3 cards + atium-using cards) | **40.04%** |

### Per-opp targeted training

The biggest single lift after lookahead was training 5 separate weight sets (`data/zoom_vs_<oppChar>/`), one per Squash-character opponent. Each set is 200k asymmetric games (Zoom seat 2 vs Squash-{X} seat 1, recording only Zoom outcomes). At runtime, `dynamicCardRating` adds a conditional lift on top of the base zoom rating only when `snap.oppCharacter` matches.

Survivorship bias (Zoom loses 65-85% of these games) is concentrated to a single matchup per dataset. Baseline normalization in the lift computation strips out the matchup-wide handicap, leaving only the per-card "what works against this specific opp" signal.

Saw +37pp on the worst matchup (vs-Shan-1st was 14-22% baseline → 54% with vs-Shan lift) and similar (smaller) lifts across all 5.

### Mission-reward synergy

User-suggested mechanic: when missions in play grant T (training) or A (atium) rewards, cards gain extra value because:
- Tier 2 unlocks at training ≥ 8 — cap=2 cards reach full effect faster
- Tier 3 unlocks at training ≥ 13 — cap=3 cards + char ability 3 + atium use all share this gate
- A rewards directly bank atium for cards with metal=8

```ts
if (rewardTypes.has("T") || rewardTypes.has("A")) {
  if (cd.capacity === 2) adjust += 0.5;
  else if (cd.capacity === 3) adjust += 1.0;
  if (cd.metal === 8) adjust += 0.6;
}
```

Tested at half size first (cap2 +0.2, cap3 +0.4, atium +0.3) — neutral. Doubled boosts pushed avg from 38% to 40%.

### Deck-composition signals

Owned-card counts of `MISSION_ENGINE_CARDS` (Pierce, Unveil, Pursue, Hyperaware, Strategize) and `DAMAGE_ENGINE_CARDS` (House War, Crushing Blow, Maelstrom, Ruin) override the static anti-correlation prior:
- ≥ 2 mission engines + 0 damage engines → commit mission regardless of opp
- ≥ 2 damage engines + 0 mission engines → commit damage regardless of opp

This handles "the deck I built signals my actual strategy" — a Zoom-Vin who's bought 3 Pierces should commit to mission even against a non-Kelsier opp where anti-correlation would suggest damage.

### Per-mission opp-lead awareness

In `scoreMissionAdvance`, penalize advancing missions where opp leads by ≥2 ranks:
- Lead ≥ 2: −5
- Lead ≥ 4: −12 (opp dominates this mission, hard to recover)

Focuses Zoom's mission actions on missions it can actually win.

## Open paths beyond 40% (untried in this session)

1. **Provincial-style co-evolved buy menus** ([BOT_RESEARCH.md](BOT_RESEARCH.md) primary recommendation 3): genetic-algorithm exploration over `(card, count)` ordered lists. Sidesteps the "stuck below buy buffer" pathology. Significant engineering. Estimated +5pp.
2. **ISMCTS with truncated rollouts**: real Information Set MCTS. Heavy engineering, +5-10pp estimated.
3. **Lookahead-aware self-play training**: full-volume retrain with lookahead enabled during data collection.
4. **Mission-set-conditional training**: separate weight sets per (oppChar, mission-set) combination. 25× dimensionality.
5. **Opp deck-composition tracking**: detect what opp has bought from visible signals (allies in play, observed discards), adapt Zoom's strategy mid-game. Currently Zoom only knows opp's character.

## Scripts

```bash
# 1. Reset weights to empty stubs (avoids feedback loops)
for c in Kelsier Shan Vin Marsh Prodigy; do
  echo "{}" > client/src/engine/data/zoom_weights/$c.json
  echo "{}" > client/src/engine/data/zoom_timing/$c.json
done

# 2. Train self-play (~8 min for 100k/char)
npx tsx client/src/engine/selfplayZoom.ts 100000

# 3. Train timing IMMEDIATELY after — must use the updated self-play snapshot
#    (~4 min for 50k/char). Skipping or running out of order regresses Zoom.
npx tsx client/src/engine/selfplayZoomTimed.ts 50000

# 4. Benchmark Zoom going second vs an opponent going first (n=1000 for tight CI)
npx tsx client/src/engine/benchmark.ts zoom V1 50            # vs V1
npx tsx client/src/engine/benchmark.ts zoom V1 50 Squash     # baseline: Squash 2nd vs V1
npx tsx client/src/engine/benchmark.ts zoom Squash 50        # Zoom 2nd vs Squash 1st
```

---

# Session distillation: how Zoom plays differently from Squash

After many tuning passes the configurations diverged enough that "Zoom is Squash with different weights" undersells what Zoom is now. This section captures *the model of how Zoom plays* and *where Squash and Zoom disagree on doctrine*.

## Bot-level performance (40k seeded bench, post-HP-fix)

| Matchup | Going-first wins |
|---|---|
| Squash 1st vs Zoom 2nd | Squash 60.26% / **Zoom 39.74%** |
| Zoom 1st vs Squash 2nd | **Zoom 71.17%** / Squash 28.83% |
| Squash mirror | 1st 68.20% / 2nd 31.80% |
| Zoom mirror | 1st 64.06% / 2nd 35.94% |

Reads: Zoom is **+10.91pp stronger than Squash in the same seat** (71.17 vs 60.26), and **closes the going-second gap by ~4pp** (Squash mirror seat-2 = 31.8%, Zoom mirror seat-2 = 35.9%). Coin-flipped average vs Squash ≈ 55.5%.

## Doctrinal differences

| Lever | Squash | Zoom | Why Zoom diverges |
|---|---|---|---|
| **Per-opp lift data** | Not used | `data/zoom_vs_<oppChar>/<zoomChar>.json` blended at 40 default, 120 Kelsier, 100 Vin | Going second + tempo deficit makes opp-conditional knowledge much higher leverage than for going-first Squash |
| **Lookahead** | None | 1-ply chain (top-K=2, followupWeight=0.6) + lethal solver | Going second needs to recognize "X enables Y" combos; lethal solver mirrors chess endgame solvers when opp HP ≤ 14 |
| **Anti-correlation of victory path** | Static (Kelsier=damage, others=mission) | Anti-correlate with opp's predicted strategy, biased by own deck | Sharing a race (mission/damage) with seat-1 opp means losing to tempo; orthogonal axis sidesteps it |
| **Per-mission opp-lead awareness** | None | Penalize advancing missions where opp leads ≥ 2 ranks | Limited actions per turn → spend them where they actually count |
| **Atium banking** | Flat cost = 2 | Cost varies with opp HP (6 / 4 / 2 / 0 by tier); **Shan = 8 always** | Save atium for late-game swing when behind on tempo; Shan in particular gains nothing from burning early |
| **Mission-victory multiplier** | 1.2 | 1.2, **Shan = 1.8** | Shan is structurally weakest (~24% wins); commit harder to her one viable path |
| **Buy buffer (Shan)** | 1.7 | **3.5** | Counter-intuitive: ultra-selective beats variance-max for Shan-zoom (see below) |

## Big lesson this session — the Shan paradox

Shan-zoom plateaued around 20-22% across many tunings. The intuitive hypothesis was variance-max: when structurally behind, take greedy/high-roll plays to overcome the deficit. **The opposite worked.**

| Shan SBUF (buy buffer) | Win rate (n=4000) |
|---|---|
| 0.5 (greedy, buy everything) | 19.90% |
| 1.7 (default) | 22.20% |
| 2.5 | 23.35% |
| **3.5 (ultra-selective)** | **24.07%** |
| 5.0 | 23.15% |

Hand-tuned high-cost preference (variance through impact) regressed even harder: SHC=4 → 21.50%, SHC=8 → 20.10%, SHC=16 → 15.78%.

**Mechanic, in retrospect:** Shan has limited money and shallow draws. Every dilution is costly because it pushes the *good* cards further apart in the deck. Variance through *more buys* hurts because most buys aren't good enough; variance through *expensive cards* hurts because it pushes Shan toward damage cards she can't deploy. **Precision beats volume when behind**, at least in this engine. Don't generalize this to all "behind" cases — it depends on the underlying mechanic of why you're behind.

## Hyperparameter table (Zoom-only knobs)

```
VS_OPP_BLEND_STRENGTH       = 40   (default; was 120)
VS_OPP_BLEND_BY_CHAR.Kelsier = 120
VS_OPP_BLEND_BY_CHAR.Vin    = 100
ZoomBot.lookaheadTopK       = 2    (was 3)
ZoomBot.followupWeight      = 0.6  (was 0.8)
ZoomBot.lethalThreshold     = 14
Shan-zoom atium cost        = 8    (overrides oppHP-based formula)
Shan-zoom mission mult      = 1.8  (vs default 1.2)
Shan-zoom buy buffer        = 3.5  (vs default 1.7)
```

**Why blend differs by char**: damage chars (Kelsier, Vin) have stable strong signals (Crushing Blow, Maelstrom) — high blend amplifies the right thing. Mission chars (Shan, Marsh, Prodigy) plateau then regress at high blend because the heuristic already pushes their best cards (Pierce, Unveil, Hyperaware) and amplifying noise hurts.

## Bug fixed this session: Game.constructor missing HP compensation

`Game.constructor` did not apply the going-second +2 HP — only `GameSession` did. So `Game.play()`-based benches and self-play training ran at 36/36 instead of 36/38. Zoom (always seat 1 in benches) was being measured *with* a 2-HP handicap relative to real games.

Quantified: 36/36 → 36.39%, 36/38 → 39.60% combined over 40k. ~3.2pp delta. **All historical Zoom training data was generated at the same 36/36 condition** since it uses `Game.play()` — which means Zoom is technically *over-trained* for harder conditions and gets a free margin in real (GameSession) play. Not a problem to retrain, but worth noting.

Fix lives in `Game.constructor` ([game.ts](game.ts) ~line 107): `36 + 2 * i` per seat, mirroring `GameSession`'s formula. `GameSession` still overrides based on actual `firstPlayer`, so my init is harmless when GameSession is in the loop.

## Things considered but not fully explored

1. **Per-character lookahead K and follow-up weight.** Single-char focused tests at n=4000 suggested Shan/Vin/Prodigy might prefer LK=3 over LK=2, with up to +1.5pp on individual chars. But the global multi-run regressed when applied (39.26% LK=2 → 39.15% per-char LK). Either the single-char gains were seed-specific, or the per-char interaction with shared follow-up weight is non-monotonic. Worth a wider seed sweep before declaring dead.

2. **Per-char buy buffer for non-Shan zoom chars.** Focused-test sweep at seeds 5M+ showed Vin BUF=3.0 → +1.6pp, Prodigy BUF=3.5 → +1.4pp. When applied to multi_run (seeds 0–900k), it regressed -2.7pp. The Shan SBUF=3.5 win replicated cleanly across seeds; the others didn't. Hypothesis: focused-test seed range hit a non-representative distribution. Re-test with multiple disjoint seed ranges *during* the focused sweep before locking in.

3. **2-ply lookahead.** Implemented as recursive 1-ply on the chosen follow-up, scaled `followupWeight²`. Cost ~2× per decision. Result: 39.37% (slight regression vs LD=1's 39.69%). Likely follow-up estimate quality decays faster than depth gain compounds. Could revisit if heuristic accuracy improves.

4. **Marsh/Prodigy hand-tuning** of mission cards (Pierce/Unveil/Hyperaware/Soother/Tineye) parallel to Shan's. Result: null effect. Reason in retrospect: opp-lift already amplifies these cards for Marsh/Prodigy; the heuristic ranks them top anyway; adding +6 to +12 doesn't change which card gets picked. Hand-tuning helped Shan because Shan's signal-poor opp-lift data needed reinforcement.

5. **Zoom buffer offset (ZBO) globally.** Sweeps -0.4 to +0.4. Within noise. Buffer tuning is character-specific, not global.

6. **Aggressive Shan atium use** (cost = -2 or 0). Hypothesis: variance-max via burning atium for swing plays. Reality: regressed to 19.9-20.1%. Same lesson as buffer — Shan wants precision, not volume.

7. **Lookahead-aware self-play retrain.** All current Zoom training was generated *without* lookahead enabled (the bot in self-play scored heuristic-only). Now that lookahead is locked in at runtime, retraining with lookahead in the loop could realign weights with deployment conditions. Risk: lookahead picks distort card-value signal (we tested this earlier — 32.6%). Could be worth revisiting now that the architecture has stabilized.

8. **Per-(opp, mission-set) weights.** 25× the dimensionality, mentioned in the previous doc. Zoom currently conditions on opp character but not on mission set. Mission set is rolled at game start and visible to both players, so the bot could legitimately train against the joint distribution. Big sample-cost increase.

9. **Opp deck-composition tracking.** Zoom currently knows opp's character but not what opp has bought. Allies in play and the public discard pile are observable; could feed a running estimate of opp's strategy. This is the natural follow-on to per-mission-opp-lead-awareness.

10. **The Shan ceiling itself.** Even with all our work Shan-zoom is at ~24% — well below other zoom chars (35-51%). Likely structural: Shan generates no Action/Talent natively, depends on missions (slow), and her status-budget advantage is partially neutralized by Squash also wanting status. Worth investigating whether a *different victory path* — e.g., explicit damage focus when paired with a damage-engine card pool — would beat the mission-only commitment we forced.

## Methodology notes

- **n=4000 focused tests have σ ≈ 0.78pp.** Anything under ~1.5pp difference is noise. Confirm with multi-run (n=20000+) at a different seed range before locking in.
- **Always run on at least 2 disjoint seed ranges** before declaring a win. Fresh seeds at 10M+ caught several false positives in this session.
- **Bench at the right HP**. After this session's `Game.constructor` fix, benches mirror real games. Pre-fix benches understated Zoom by ~3pp.
- **Counter-intuitive gains are real.** The Shan SBUF=3.5 result wouldn't have been found without the user pushing the variance-max hypothesis — it was the *opposite* of what we expected, and it required actually testing both directions to find.

---

# SquashV2 — Going-FIRST Specialist

SquashV2 is the seat-0 sibling of Zoom. Same architecture (action-scoring + lookahead + lethal solver) but trained on seat-0-only data and tuned for the tempo-advantage seat. Final win rate vs Zoom-going-second: **~70.5%** (n=10000 seed-deterministic, 5-seed avg 69.98%).

## Headline matchup

| Matchup | Win rate (n=10000) |
|---|---|
| SquashV2 1st vs Zoom 2nd | **70.53%** |
| SquashV2 1st vs Squash 2nd | 76.35% (n=4000) |
| SquashV2 1st vs V1 2nd | 89.25% (n=4000) |

For comparison, plain Squash going-first vs Zoom going-second is ~61% (inferred from BOT_NOTES "Zoom 2nd vs Squash 1st = 38.88%"). SquashV2 adds **~9pp** over plain Squash in the going-first seat.

## Architecture

- **`squashV2Bot.ts`** — `class SquashV2Bot extends SquashBot` overriding `evalProfile = "squashV2"`. Lookahead+lethal solver gated on `turnOrder === 0` (mirror of Zoom's `=== 1` gate).
- **`squashBotEval.ts`** — adds `BotProfile = "squash" | "zoom" | "squashV2"`. Mirrors Zoom's data plumbing: own self-play weights, timing, per-opp lifts, baseline normalization for asymmetric seat-0 data. Mutable `SquashV2Config` exports baked-in best defaults.
- **`selfplaySquashV2.ts`** — mirror Squash-V2-vs-Squash-V2 games, recording seat 0 only.
- **`selfplaySquashV2Timed.ts`** — phase-aware timing data, seat 0 only.
- **`selfplaySquashV2VsZoom.ts`** — asymmetric V2-vs-Zoom for per-opp lifts.
- **`squashV2Ablation.ts`** — single-config-per-invocation ablation harness.
- **`benchmark.ts v2 <opp> <n> <bot> <seedOffset>`** — seeded benchmark.

## Engine bug fixed: Maelstrom infinite loop

`Player.special11()` (Maelstrom card's tier-3 effect) was an infinite loop. The intent was "trash all market cards", but the implementation iterated `while (market.hand.length > 0)` calling `market.buy()` each pass — and `market.buy()` always refills hand via `draw(1)`. Net hand size stayed constant; loop ran until process kill.

Reproduced inline: 101 buys in 1ms with no termination signal. Fix in [player.ts](player.ts) `special11()`: snapshot hand contents, clear `market.hand`, push to discard, then `market.draw(originalCount)` once. Bounded by hand size (~5).

This bug masked the entire session's training/benchmark pipeline:
- Zoom going-second avoids it because Zoom's heuristic plays Maelstrom less often when behind.
- SquashV2 going-first picks Maelstrom more aggressively. Lethal solver simulating Maelstrom triggered the loop within snapshot/restore — caught by selectAction wallclock budget eventually but bench games still hung 5-30+ minutes per problematic seed.

Identified by isolating `seed=2000056` in Kelsier-vs-Marsh, tracing each `selectAction` and `performAction`, and seeing a single `use_metal Maelstrom` in lookahead simulation never returning.

## Defensive levers added (kept)

To prevent similar pathologies surfacing later:

- **Lethal-solver per-turn cap** (cap=3) + cache by (turn, curDamage). Lethal solver chains can return non-damaging first actions (use_boxing, burn_card) that don't grow curDamage but still get performed — without a cap, lethal re-runs forever each `selectAction`.
- **Wall-clock budgets** at 3 levels: 50ms per `findLethalAction` invocation, 100ms (or remaining decision-budget) per chain lookahead, 250ms total decision budget. Beyond budget → fall back to heuristic-only via `super.selectAction`.
- These are also ported to ZoomBot for parity.

## Ablation findings (what mattered)

Empirically with full training data (50k mirror, 10k timing, 30k/pair asym vs Zoom):

| Lever | Δ vs baseline | Status |
|---|---|---|
| `baselineNormalize` (seat-0 data is asymmetric) | **+26pp critical** | always on |
| Lookahead | +6pp | on, K=2 |
| Per-opp lifts (vs-Zoom training) | +6pp | on, blend=40 |
| Per-char buy buffer = 5.0 (was 1.5–1.8) | +3pp | on |
| Self-play blend = 40 (was 80) | +0.9pp | on |
| `atiumBankingMode = zoomCurve` | +0.78pp | on |
| Lethal solver | +1.3pp | on |
| Mission-reward synergy | ≈0 | on (universal) |
| Anti-correlation | ≈0 | off (going-first commits) |
| Shan card tunings (zoom-Shan style) | -0.5pp | OFF (opposite of zoom) |
| Shan mission mult > 1.2 | noise | 1.2 (zoom uses 1.8) |
| Lookahead K (1, 2, 3, 4, 5) | K=2 best | 2 |
| Followup weight (0.4–1.0) | 0.6 best | 0.6 |
| 2-ply lookahead | -0.4pp | off |
| Per-char vsOpp blend (zoom-style) | -1.5pp | off |

## What did NOT push past ~70%

Asymptote at ~70.5% across many ablation cycles. Tried (none broke through):

1. Buy buffer values 2.0–10.0, per-char and global. Plateau at 5.0.
2. Self-play blend 0–160. Peak at 40.
3. vs-Opp blend 20–120 globally and per-char. Default 40 wins.
4. Lookahead K=1–5. K=2 wins.
5. Followup weight 0.4–1.0. 0.6 wins.
6. 2-ply lookahead (recursive on top followup). Slight regression.
7. Anti-correlation toggle. Off wins.
8. Atium curve toggle. zoomCurve wins by 0.78pp.
9. Shan-specific card tunings (mirroring zoom). Hurt -0.5pp.
10. Shan mission multiplier 1.0–4.0. All within noise.
11. Per-character buy buffer asymmetry. Symmetric 5.0 wins.
12. Mirror training scaling 1k → 50k/char. +1pp 1k→20k, plateau after.
13. Asymmetric vs-Zoom scaling 1.5k → 30k/pair. +7pp 1.5k→5k, plateau after.

## Per-character matchup analysis (final config)

Best config breakdown (n=4000 each):

| V2 char | avg vs all Zoom chars |
|---|---|
| Kelsier | 78.6% |
| Shan | 54.3% ← weakest |
| Vin | 72.1% |
| Marsh | 72.6% |
| Prodigy | 73.9% |

Weakest individual matchups: Shan vs Kelsier (43%), Shan vs Vin (52%). Shan is structurally weak (matching zoom's findings — but going-first only lifts her 49.9% → 54.3% even with all tunings, ~30pp below other chars).

Shan-as-V2 was extensively swept (buffer 3–10, missionMult 1.0–4.0, card tunings on/off) — none of these levers broke through the ~55% Shan ceiling.

## Critical training-pipeline rules

Discovered while iterating:

1. **`selfplaySquashV2VsZoom.ts` had a feedback-loop bug.** Default `vsOppBlend=40` during training meant the bot's choices were biased by previous-iteration data → self-confirming, non-generalizing weights. 5k/pair → 68.5%, 20k/pair → regressed to 58%. Fix: rebenchmark with fresh stubs.
2. **Don't use `--blend-zero` for asymmetric training.** Setting `vsOppBlend=0` during V2-vs-Zoom training makes V2 play out-of-equilibrium (no per-opp signal) against trained-Zoom. 20k/pair clean → 64.5% (worse than dirty 5k/pair at 68.5%). The right thing is to use runtime-equilibrium blend with fresh stubs. (Mirror training is different — `selfPlayBlend=0` is correct for mirror because both seats are V2 so symmetry holds.)
3. **Train timing IMMEDIATELY after self-play.** Same rule as zoom — timing baselines must come from the same bot snapshot the self-play data did.

## Final hyperparameter snapshot

In `squashBotEval.ts SquashV2Config`:
```
atiumBankingMode = "zoomCurve"
buyBufferOverride = { all chars: 5.0 }
selfPlayBlend = 40           (vs squash's 80, zoom's 80)
vsOppBlend = 40
vsOppBlendByChar = {}        (per-char regressed for V2)
baselineNormalize = true
shanCardTunings = false      (opposite of zoom)
shanMissionMult = 1.2        (zoom uses 1.8)
oppLeadAwareness = true
missionRewardSynergy = true
antiCorrelation = false
```

In `squashV2Bot.ts`:
```
lookaheadEnabled = true
lethalThreshold = 14
lookaheadTopK = 2
followupWeight = 0.6
lookaheadDepth = 1
MAX_LETHAL_CALLS_PER_TURN = 3
```

## Scripts

```bash
# Reset weights and train from scratch
for c in Kelsier Shan Vin Marsh Prodigy; do
  echo "{}" > client/src/engine/data/squashV2_weights/$c.json
  echo "{}" > client/src/engine/data/squashV2_timing/$c.json
  for d in kelsier shan vin marsh prodigy; do
    echo "{}" > client/src/engine/data/squashV2_vs_$d/$c.json
  done
done

# Train mirror (50k/char) — uses --blend-zero by default for fresh runs
npx tsx client/src/engine/selfplaySquashV2.ts 50000

# Train timing (10k/char) — IMMEDIATELY after mirror
npx tsx client/src/engine/selfplaySquashV2Timed.ts 10000

# Train asymmetric vs Zoom (10k/pair × 25 = 250k games)
npx tsx client/src/engine/selfplaySquashV2VsZoom.ts 10000

# Bench (n=200 per matchup × 20 matchups = 4000 games, ~50s under load)
npx tsx client/src/engine/benchmark.ts v2 Zoom 200 SquashV2 1

# Single-config ablation (CSV output)
npx tsx client/src/engine/squashV2Ablation.ts <configName> Zoom 500 1
```

## Open paths beyond 70% (untried in this session)

The asymptote at ~70.5% suggests something fundamental needs to change to push higher. Options not attempted:

1. **MCTS / ISMCTS** — proper game-tree search instead of 1-ply heuristic chain. Estimated +5-10pp, heavy engineering.
2. **Provincial-style co-evolved buy menus** — genetic algorithm over `(card, count)` ordered lists. Sidesteps the buy-buffer plateau. Significant engineering.
3. **NN value function** — train a small NN on (state, action, outcome). Could replace the analytical+blend formula entirely. Expensive setup.
4. **Mission-set conditional training** — separate weight sets per (oppChar, mission-set). 25× dimensionality, much more training cost.
5. **Opp-deck modeling** — estimate Zoom's deck composition from observable signals (allies in play, public discard) and adapt strategy. Currently V2 only conditions on opp character.
6. **Heuristic improvements** — `estimateEffectValue` and the "special1-special16" handlers may have undervalued cards. Worth a careful audit, especially for Shan whose ceiling we couldn't break with config tuning alone.

---

# Hulk X90 — composite seat-specialist bot (default for bot play)

Hulk X90 is a one-line composition: pick the best-known specialist for each seat.

```ts
// hulkX90Bot.ts
return turnOrder === 0
  ? new SquashV2Bot(...)
  : new ZoomBot(...);
```

Going first → SquashV2 (seat-0 specialist). Going second → Zoom (seat-2 specialist). The returned Player IS a real SquashV2Bot/ZoomBot, so session.ts, lookahead, lethal solver all work without changes.

## Headline (n=2000 seeded, coin-flipped seats)

| Matchup | Hulk win% |
|---|---|
| Hulk vs Twonky | **81.7%** |
| Hulk vs Squash | **58.3%** |
| Hulk vs Zoom | **53.3%** |
| Hulk vs SquashV2 | **50.0%** |

## Composition verification

| Hulk seat | Opp | Hulk win% | Expected (= specialist alone) |
|---|---|---|---|
| 0 (= V2) | Squash 1 | 76.3% | V2 1st vs Squash 2nd = 76.4% ✓ |
| 1 (= Zoom) | Squash 0 | 39.2% | Zoom 2nd vs Squash 1st = 39% ✓ |

Numbers match the underlying specialists exactly — Hulk inherits each bot's seat-specific advantages without compromise.

## Coin-flipped vs Hulk's components

Vs SquashV2 head-to-head (50%): both Hulk-in-seat-0 and V2 are the same logic (V2), so Hulk-1st vs V2-2nd = V2 mirror ≈ 68%. Hulk-2nd (= Zoom) vs V2-1st = 29.6% (V2's strong matchup vs Zoom). Average ~49% — tied. V2 is just as strong as Hulk against itself because Hulk's only seat-1 substitution (Zoom) is actually weaker than V2 in seat 1 vs a V2-going-first opp (29.6% vs V2-mirror's ~32%). For most other opps Zoom-seat-2 is better than V2-seat-2.

## Where Hulk's composition isn't perfect

V2-seat-2 vs V2-seat-1 (mirror) wins 32%; Zoom-seat-2 vs V2-seat-1 wins 29.6%. So vs V2-going-first specifically, V2-as-seat-1 is the better choice — but Hulk uses Zoom there. Trade-off: Hulk is the strongest universal bot but loses ~2.4pp to V2-pure in the V2-mirror matchup. For real games vs anything other than V2, Hulk's Zoom-in-seat-1 is strictly better.

## Wiring

- [hulkX90Bot.ts](hulkX90Bot.ts) — factory dispatcher
- [session.ts](session.ts) — `PlayerKind = ... | "bot_hulk"`, `makePlayerFactory("bot_hulk")`, `opponentTypeToKind("hulk")`
- [benchmark.ts](benchmark.ts) — `BOT_FACTORIES.Hulk`
- [data/ministrySigils.ts](../data/ministrySigils.ts) — `BOT_TYPES` includes "hulk"
- [hooks/useMinistryPrefs.ts](../hooks/useMinistryPrefs.ts) — `DEFAULT_BOT_CONFIG.botType = "hulk"` (new default for UI bot play)

---

# Anvil — evolved-policy composite bot (candidate successor to Hulk X90)

Anvil is Hulk's seat composition (SquashV3 going first, Zoom going second)
plus a per-character, per-seat **evolved policy** trained directly against the
Hulk counterpart it has to beat. It is the first bot here built on the
BOT_RESEARCH.md Provincial finding ("most leverage is in *what you buy*, not
what you play") plus joint multi-knob tuning of the heuristic's assumptions.

## Headline (all on seed ranges never used in training or selection)

| Matchup | Result |
|---|---|
| **Anvil (r7) vs Hulk, coin-flipped seats** | **51.7%** pooled, 4650/9000, ≈3.2σ (n=3000 ranges: 51.4% @2.9B, 51.4% @3.1B, 52.2% @3.3B) |
| Anvil (r3 roster, superseded) vs Hulk | 51.5% pooled, 4787/9300 (52.2/49.6/52.8 @1.3/1.9/2.1B) |
| Anvil (r7) vs Squash flip | **61.0%** vs Hulk-control 58.2% — league training generalizes (+2.8pp) |
| Anvil seat0 vs Zoom 2nd | 71.7% vs zero-control 71.3% (1.3B) |
| Anvil seat1 vs SquashV3 1st | 32.5% vs zero-control 30.4% (1.3B) |
| Anvil vs Squash flip (gauntlet) | 59.7% vs Hulk-control 59.0% (no regression) |
| Anvil vs V1 flip (gauntlet) | 83.1% vs Hulk-control 83.0% (no regression) |

Range-to-range variance in the flip is large (±2-3pp at n=3000) — quote the
POOLED number, not a single range. Paired seat benches were positive on all
three held-out ranges (900M / 1.1B / 1.3B): seat0 ≈ +1.1pp avg, seat1 ≈
+1.6pp avg. Modest but real — same size class as the compounding layers that
built Zoom. Biggest per-char lifts: Marsh-first (+5.3 to +7.5pp on three
independent ranges — the single strongest policy), Kelsier-second
(+2.8/+3.2/+5.3), Vin-second, Prodigy-second.

## Architecture

- **[anvilBot.ts](anvilBot.ts)** — `AnvilFirstBot extends SquashV3Bot`,
  `AnvilSecondBot extends ZoomBot`, `createAnvilBot` dispatcher. Policy =
  `{deltas, knobs}` per (seat, character), committed in
  [data/anvil_policy.json](data/anvil_policy.json). Empty policy ≡ Hulk
  exactly (verified game-for-game on seeds).
- **deltas** — per-market-card rating deltas injected at `cardRating`, so they
  flow through buys, boxing redemption, eliminates, pulls, market pushes AND
  the chain lookahead. Sidesteps Known Weakness #3 (cards stuck below the buy
  buffer never get self-play data): the ES explores by mutation, not by
  current rating.
- **knobs** — 19 scalars: additive/multiplicative shifts on the heuristic's
  core assumptions (mission/useMetal/ally/charAbility bases, buy mult+bias,
  end-turn bias, flare/burnMetal/burnCard/refresh/atium/boxing costs) plus
  lookahead shape (`lookTopK`, `lookDepth`, `lookFollowupWeight`,
  `lookLethalThreshold`, `lookGapGate`). Enabled by refactoring
  SquashV2Bot/ZoomBot's hardcoded lookahead statics into protected instance
  getters (behavior-neutral — exact seeded-bench match) and flipping 4
  scoring methods private→protected.
- **`lookGapGate`** (new) — skip chain lookahead when the heuristic best
  beats the runner-up by ≥ gate. Prunes wasted simulation on decided picks.

## Training — [anvilEvolve.ts](anvilEvolve.ts)

(μ+λ) evolution strategy per (seat, character): pop 16, 4 elites, ~20-25 gens,
fitness = win rate over 160-200 seeded games vs the frozen Hulk counterpart
(AnvilFirst vs Zoom-second / SquashV3-first vs AnvilSecond), opponent sweeping
the other 4 characters.

Guards that mattered (all inherited from earlier methodology lessons):
- **Common random numbers** within a generation; **fresh seeds every
  generation** (elites re-evaluated — lucky-seed genomes don't stick).
- **Held-out validation block** with the zero genome included: a run that
  can't beat zero outputs "rejected", not noise.
- **Cross-range replication before shipping.** Every val-accepted policy was
  re-benched on 2-3 further disjoint ranges with paired zero controls; only
  never-negative policies shipped. This killed ~half of val-accepted
  policies (see below) — the val gate alone is NOT sufficient.

Three rounds: r1 deltas-only from zero; r2 deltas-only, keepers continued +
rejects retried at a new seed base; r3 (KNOBS=1) joint deltas+knobs from the
promoted best-of-r1/r2. ~10 min per (seat,char) per round with all 10 jobs
parallel (run_r2.sh / run_r3.sh in data/anvil_evolve/).

## Final roster (data/anvil_policy.json)

| Seat | Kelsier | Shan | Vin | Marsh | Prodigy |
|---|---|---|---|---|---|
| first | **r4-league** | **r4-league** | r3 | **r3** | r3 |
| second | r3 | r2 | r4-league | r2 | r3 |

r4 = league round: fitness vs {frozen committed Anvil, Hulk specialist,
Squash} with successive-halving evaluation (480-game finalists) and an
in-run double validation gate (must beat zero on two disjoint held-out
blocks). It cracked the two previously-dead slots — first/Kelsier
(+3.0/+3.8pp vs Zoom on two fresh ranges) and first/Shan (+2.0/+3.2pp) —
and improved second/Vin. Its other winners did NOT transfer to the
vs-Zoom/V3 metric (they gained on the league mix instead) or flip-flopped
across ranges (second/Kelsier +1.5 then -3.0) and were not shipped.
first/Marsh-r4 regressed -4.2 vs Zoom (league pull off the anti-Zoom
optimum) — the r3 crown jewel stays.

"zero" = no policy (plays exactly like Hulk's specialist). first/Kelsier and
first/Shan had val-accepted policies that flipped sign across seed ranges —
dropped.

## What the knobs discovered (Henry's "multiple at a time" hypothesis)

- **Depth-2 lookahead is net-positive when jointly tuned.** 5 of 9 r3 winners
  kept `lookDepth=2` — but always with a retuned follow-up discount
  (0.5-0.68 vs default 0.6 applied twice) and usually a gap gate. Isolated
  depth-2 at default weights regressed in both the Zoom and V2 sessions;
  joint tuning is what makes deeper search pay.
- **Buy less, more selectively.** Nearly every winner carries negative
  `buyAdd` (-1.5 to -12) and/or `buyMult` < 1 on top of per-card deltas.
  The Shan "precision beats volume" lesson generalizes.
- **Kelsier-second re-discovered anti-correlation by evolution**:
  missionAdd=-15.8, allyAdd=+10.9 — it shifts off the mission race onto
  ally/board value without being told about victory paths.
- first/Marsh (the strongest policy): lookTopK=4 + gapGate + depth 2 —
  wider AND deeper search, paid for by pruning.

## Honest failures / lessons

- **Seed-range false positives are the norm, not the exception.** r1
  second/Kelsier: +4.0pp on its val block, -3.3pp on a fresh range. r3
  second/Marsh: +3.2 val, -5.0 fresh. Two ranges minimum, three preferred.
- Evolving vs one frozen opponent risks exploiting that opponent; the
  Squash/V1 gauntlet was the guard. Result: no regression (the policies
  generalize, they don't just exploit Hulk's determinism).
- Two configs can produce byte-identical aggregate win counts on 400 games
  by coincidence — check the bench's policy-load lines before concluding a
  policy "didn't load" (or didn't matter).
- Wall-clock lookahead budgets make heavily-loaded benches *slightly*
  nondeterministic. All ship/kill decisions were made on paired runs under
  equal load.

## Scripts

```bash
# Bench the shipped (committed) Anvil
npx tsx client/src/engine/anvilBench.ts flip Hulk 150 1300000001
npx tsx client/src/engine/anvilBench.ts seat0 Zoom 100 900000001
npx tsx client/src/engine/anvilBench.ts seat1 SquashV3 100 900000001
ANVIL_ZERO=1 ... # zero-policy control (≡ Hulk)
ANVIL_SUFFIX=r3 ... # bench a specific evolution round's outputs

# Evolve one (seat, character); KNOBS=1 adds joint knob evolution
KNOBS=1 npx tsx client/src/engine/anvilEvolve.ts second Kelsier 25 16 50 101 [initFile] [outSuffix]
```

## Open paths

1. **Co-evolution / league play** — evolve vs a mix of opponents (Hulk +
   Squash + past Anvil generations) to push generality instead of a single
   frozen target.
2. **Round 4+ with bigger eval blocks** — selection noise (σ≈3-4pp at 160
   games) is the current bottleneck; 500-game evals would let smaller real
   gains survive selection.
3. **Seat0 Kelsier/Shan** — no stable policy found; both may genuinely be at
   their ceiling, or need knob-only runs (deltas froze to noise first).
4. **Wire into the app** (session.ts PlayerKind "bot_anvil", ministrySigils
   BOT_TYPES, useMinistryPrefs default) — deliberately NOT done yet.

---

# Value model — learned P(win) + veto integration (Anvil seat 2)

The first learned evaluation in the codebase: a small MLP predicting P(win)
from end-of-turn states, integrated into AnvilSecondBot as a **confidence-
gated veto** over the heuristic's action choice. This finally moved the
seat-2 needle that all prior tuning could not.

## Headline (fresh seed ranges, paired controls)

| Matchup | With veto | Control |
|---|---|---|
| Anvil seat1 vs SquashV3 1st (3 ranges) | +1.7 / +5.2 / +2.8pp (**avg +3.2pp**) | 33.1 / 31.1 / 31.8% |
| **Anvil vs Hulk, coin-flipped (n=9000)** | **54.3%** (54.3/54.0/54.6 per range) | prev roster: 51.7% |
| Anvil vs Squash flip | 61.9% | Hulk same seeds: 57.3% |
| Anvil vs V1 flip | 82.0% | Hulk: 81.4% |

## Architecture

- **[valueModel.ts](valueModel.ts)** — 60-feature end-of-turn featurizer
  (HP, per-mission aggregates incl. min-rank, deck composition for BOTH
  players — opp's is derivable from public buys —, allies/defenders,
  training, perms, characters, seat) + logistic/MLP inference.
  Weights: [data/value_weights.json](data/value_weights.json).
- **[valueDataGen.ts](valueDataGen.ts)** — self-play data: one row per
  player-turn at the post-playTurn boundary, labeled with the final outcome.
  Mixed bot pool weighted toward V3-vs-Anvil. ~100k games total (incl. one
  DAgger iteration adding the value-bot's own trajectories).
- **[valueTrain.ts](valueTrain.ts)** — streaming SGD in plain TS. Logistic
  and 1-hidden-layer MLP (48 ReLU units, shipped). Held-out split BY GAME.
  MLP: 74.7% acc / AUC 0.837 on pre-DAgger data (baseline hpDiff+missionDiff:
  64.6% / 0.708). Exploitable mid-turn resource features are masked at train
  time (see below).
- **Integration (anvilBot.ts AnvilSecondBot)** — veto mode, ON by default at
  margin 0.08: compute the heuristic's pick normally, then end-of-turn
  rollout (greedy heuristic completion → assignDamage → attack → P(win)) for
  the top-6 candidates; play the value model's choice only when it beats the
  heuristic pick's P(win) by ≥ 0.08. Margin is flat 0.05-0.12 (robust).
  Env overrides in benches: ANVIL_VALUE_LEAF=0 (off), ANVIL_VL_VETO/BLEND/TOPK.

## The failure catalog (read before "improving" this)

Four integration attempts FAILED before the veto worked — each is a lesson:

1. **Immediate post-action P(win) as lookahead leaf → 0.1% win rate.** The
   bot farmed causally-invertible mid-turn features: flare-everything
   (+metalsAvailable), burn-everything (deck "thinning"). A cross-state
   observational model rewards winner-CORRELATES, and argmax finds them.
2. **Masking the 8 exploitable resource features → 6%.** Whack-a-mole:
   argmax finds the next hole. (The masked features carried ~no unique
   signal — 71.6% → 71.6% acc — confirming they were pure correlates.)
3. **End-of-turn rollout leaf + logistic → 26-27% (sane but -5pp).** The
   turn-boundary evaluation kills the farming exploits structurally, but a
   linear model can't out-discriminate a tuned heuristic between candidates
   whose turn-end states differ only subtly.
4. **Same + MLP → 1.5%; + one DAgger iteration → still 1.7%.** Nonlinear
   models have richer blind-spot surfaces; one aggregation round didn't
   close them. Pure value ARGMAX against an observationally-trained model
   is adversarially unstable in this codebase. Full stop.
5. **Additive blend (heuristic + λ·value): neutral at λ=0.3, harmful at 0.7.**
6. **Veto (margin-gated override) → +3.2pp avg, 3/3 ranges positive.** The
   bot is the heuristic by default; the model only overrides on large,
   high-confidence strategic disagreements — no gradient to farm, and the
   model's real skill (game-level strategic assessment) is exactly what
   crosses the margin.

## Retraining pipeline

```bash
# 1. Generate end-of-turn data (10 parallel shards, ~40k games, ~10 min)
for i in 0 1 2 3 4 5 6 7 8 9; do
  npx tsx client/src/engine/valueDataGen.ts $i 6000 <seedBase> &
done; wait
# (optional DAgger shards: prefix ANVIL_VALUE_LEAF=1, shard ids 10+)

# 2. Train (MLP=48 hidden units; ~5 min)
MLP=48 NODE_OPTIONS=--max-old-space-size=8192 npx tsx client/src/engine/valueTrain.ts 4 0.1 1e-6

# 3. A/B with paired controls on fresh seed ranges
npx tsx client/src/engine/anvilBench.ts seat1 SquashV3 100 <freshSeed>
ANVIL_VALUE_LEAF=0 npx tsx client/src/engine/anvilBench.ts seat1 SquashV3 100 <freshSeed>
```

## Arc 2: opponent-reply rollout (SHIPPED — the biggest single lift)

The evaluation boundary moved from "my turn just ended" to "the opponent's
reply just resolved": after the greedy turn completion + attack, the veto now
simulates the opponent's ENTIRE reply turn (heuristic-only — lookahead
statics disabled, recursion-guarded via _simulating, turncount bumped and
snapshot-restored) and evaluates P(win) there. This sees "if I end my turn
like this, the opponent kills me / closes a mission" — invisible before.

- Featurizer v2: 61 features (+ postOppTurn phase flag). Training rows come
  in pairs per turn boundary: actor perspective (phase 0) + passive
  perspective (phase 1) of the same game moment. 60k games, ~2.4M rows.
- Falls back to phase-0 evaluation when the opponent isn't a simulatable
  bot (not a SquashBot subclass — e.g. a human in the app).
- Seat1 vs SquashV3: 39.3/37.3/38.6 on the reference ranges (prev veto:
  34.8/36.3/34.6; no-veto: ~32) + 37.8 vs 32.6 paired on a 4th fresh range.
- **Anvil vs Hulk flip: 55.3% pooled (4974/9000; 56.8/55.0/54.0)**, was 54.3.
- vs Squash flip: 66.3% vs Hulk-control 59.5%. V1 flat (81.0).

Seat-2 vs V3 across the whole campaign: Zoom 29.5% → evolved policies ~32% →
turn-end veto ~35% → opp-reply veto ~38.4%.

## Post-ship experiments on the TURN-END veto (both dead before arc 2)

- **Seat-0 veto (margin 0.08)**: flip-flopped across fresh ranges (+1.8pp
  @5.1B, -2.9pp @5.3B) — killed. The tempo-setting seat's heuristic is
  already strong; the model's edge is underdog strategy. AnvilFirstBot has
  the integration behind ANVIL_VL_SEAT0 (default off) if revisited.
- **DAgger-2 (+40k veto-bot games) + wider MLP (64 hidden)**: 34.4/35.1/34.8
  vs shipped model's 34.8/36.3/34.6 on the same ranges — statistically
  identical. The veto overrides rarely, so behavior barely shifts with model
  refreshes. Shipped weights stay v1 (48 hidden, three-range evidence).

## Open paths

1. **Opponent-reply rollout** — extend the evaluation boundary past the
   opponent's predicted reply turn. Needs a phase-aware featurizer (passive-
   perspective training rows + a postOppTurn flag → full retrain) and cheap
   opp-turn simulation (temporarily disable the opp's lookahead statics
   inside the sim). The most direct extension of what worked.
2. **Deeper model / more data for margin-level discrimination** — neutral so
   far at 64 hidden; likely needs the sharper target from (1) first.
4. **Train on Henry's games** — the InstantDB match history is (state,
   outcome) data against the opponent that actually matters.
5. **Opponent-turn rollout** — current rollout stops at own turn end; one
   opp reply (predicted by heuristic) would sharpen the P(win) target.

## Arc 3: learning from Henry's games (SHIPPED)

Henry has a positive winrate going second vs Hulk — the strongest seat-2
play the system has data access to. Pipeline:

- **[henryReplayGen.ts](henryReplayGen.ts)** — fetches recorded matches from
  InstantDB (seed + structured actionLog) and reconstructs them by
  deterministic replay through GameSession: human events feed the session
  entry-points 1:1; bot turns regenerate from the seed. **Fidelity gate**:
  rows are emitted only when the replayed end state exactly reproduces the
  stored ground truth (winner, victoryType, turnCount, missionRanks,
  training). Engine drift since recording breaks old matches — they are
  DROPPED, never approximated. Pre-SquashV3 matches retry with V3's flags
  off (= exact V2). Result: 273/664 matches kept -> 10,182 dual-phase rows.
- **Model transfers to human play**: arc-1 model scored AUC 0.817 on
  Henry-perspective states it had never seen a distribution like.
- **The learnable signal, quantified**: in 24% of Henry's late-game (t16+)
  WINNING states, the model gave him < 35% — positions the bot's worldview
  writes off, which Henry systematically converts.
- **Fine-tune** (`HENRY_W=25 MLP=48 valueTrain.ts`): Henry rows mixed in at
  25x duplication (~10% of effective training mass), held-out split by whole
  match. Three ship-gates, all passed:
  | Gate | arc-1 | Henry-tuned |
  |---|---|---|
  | Henry held-out matches (Henry-perspective acc / AUC) | 73.2% / 0.810 | **76.4% / 0.850** |
  | Self-play held-out (no degradation) | 85.25% / 0.3733 | 85.22% / 0.3692 |
  | seat1 vs V3 (3 ranges) | 39.3/37.3/38.6 | 39.4/38.9/38.6 |
  | flip vs Hulk (fresh range) | 54-57 band | 54.9% |

Caveat stated honestly: benches measure vs bots. The tuning's real target —
playing better against HENRY — is only testable by Henry playing Anvil.
New matches feed the same pipeline: re-run `henryReplayGen.ts fetch/replay`,
retrain with `HENRY_W=25`, re-gate.

## Follow-ups after arc 3

- **Move-order feature fix**: `mySeat` encoded turnOrder, which equals move
  order in ALL self-play data but NOT in Henry's matches (he is turnOrder 0
  moving second when firstPlayerIndex=1). Now `movesSecond` =
  (turnOrder !== game.firstPlayer); Game stores firstPlayer. Self-play data
  values are unchanged (firstPlayer=0 there); henry.csv regenerated and the
  model retrained. Henry-held-out AUC held (0.844 vs 0.850, n=467); the
  fixed-threshold accuracy dipped because the model now correctly applies
  the second-mover discount to Henry's states — the old semantics had been
  accidentally crediting him as a first-mover, which happened to fit his
  above-baseline seat-2 results. Correct semantics matter now that Henry is
  switching to RANDOM seat order (previously always second).
- **Seat-0 veto, second kill**: retested with the opp-reply Henry-tuned
  model at margin 0.08 — still range-flip-flops, now violently (−5.2pp
  @6.9B, +5.7pp @7.1B). The veto changes seat-0 play a lot with directionless
  outcomes. OFF for good barring a seat-0-specific investigation.

## Twin-seed case study (2026-07-18): the mission-burst gap

Henry beat Anvil twice on seed 2485000322 from BOTH roles (Shan-first and
Marsh-second) — the only pair of three twin-seed experiments where the
player, not the role, decided the outcome (seeds 60818057 and 905579475
were role-decided: same role won regardless of pilot).

Decisive evidence from the Marsh-second role, turn 10 (Henry at 8% model
P(win), 7/14 missions behind — jumped to 85%):

- Bot-Marsh's t10 (twin game): singles into Luthadel Garrison 3->8, one
  boxing banked. Linear grind.
- Henry's t10: Deceive eliminating 2 Fundings mid-combo, Inspire, Soother,
  CLOSE Kredik Shaw 7->12 (+hand-size reward), flare, open Pits 0->4 (+2
  money reward), bank 8 money -> 4 boxings. Multi-source burst crossing two
  reward thresholds that feed the same turn.

The bot's greedy scoring + 1-2 ply lookahead cannot see 10-action
compounding chains; the value model shares the blindness (it scored the 8%
state as lost). This also reframes the divergence-analyzer finding that
"Anvil's mission picks score better on average": Henry's picks are
threshold/reward-aware in ways neither the heuristic nor the model
represents.

**Next structural idea: MISSION-BURST SOLVER** — mirror of findLethalAction:
when the hand+board's total realizable mission points this turn can cross a
completion or first-reward threshold, search the action chain explicitly
(bounded, budgeted) instead of trusting greedy per-action scores. Candidate
trigger: sum of available Mi effects >= min(distanceToComplete,
distanceToNextFirstReward) on any mission.

Tooling: [twinReport.ts](twinReport.ts) — P(win) trajectories + per-turn
state for both games of a twin seed. (Game A of the pair rejects replay on
a prompt mismatch — recorded on the same evening as engine fixes; the
fidelity gate is doing its job.)

## Twin-seed case study 2 (seed 3820987199): identical buys, different tempo

Prodigy-first vs Shan-second; Henry won BOTH roles. The first-mover role
opened identically in both games (buy Lookout, start Keep Venture) — so the
divergences are unusually clean:

1. **Early tempo spent on self vs on opponent.** Same turn-1, same role:
   Henry burned BRASS (+1 money +1 mission) into the Lookout buy + mission;
   the bot burned PEWTER (+2 damage) and FLARED IRON (+2 more damage) at a
   38-HP opponent, ending with 4 chip damage and a spent flare token.
   Henry's t1 compounds (money/mission/training feed later turns); early
   chip damage vs full HP converts to almost nothing. Game A trajectory:
   Henry-Prodigy 80% model P(win) at t1 and monotonically up.
2. **Second-mover mission anti-contest.** As Shan-second the bot immediately
   raced Keep Venture (the first mover's own mission) and by its 3rd turn
   was spending Eavesdrop reactively to block; Henry opened Canton instead
   and compounded training. The oppLead penalty only fires at lead>=2 — too
   late; the contest decision happens at rank 0-1.

Bot-testable hypotheses (n=1 pair + consistent with the 162-game burst
analysis; NOT conclusions until benched):
- Early-phase damage discount when opp HP high and victory path != damage.
- Stronger early-flare reluctance (flare spends a refreshable token for
  tempo the turn may not need).
- Second-mover early anti-contest: penalty for advancing a mission the
  first mover opened, at lead >= 1, during the first ~6 turns.
- Plus the mission-burst solver (case study 1), aimed at the measured
  ~3-point burst gap (Henry p50 max-burst 8-9 vs bot 5-6; burst>=10 =>
  Henry wins 86%).

## Mission-burst solver + buy-or-bank (from Henry's games) — SHIPPED on AnvilSecond only

Two features motivated by the twin-seed studies, validated with the usual
kill discipline. Key architectural lesson, twice-confirmed: **solvers may
propose, only the value model may dispose.**

- **findMissionBurstAction** (anvilBot.ts): lethal-solver mirror for the
  mission win condition — when realizable Mi this turn can cross a
  completion or first-reward threshold, search bounded greedy chains.
  - As a hard OVERRIDE it fails: seat-1 override 24% (vs 39 ref); seat-0
    completion-only override 67.0 (vs 72.5). The solver's route to a
    crossing is often worse than the greedy line.
  - As a VETO CANDIDATE (chain's first action joins the candidate set, the
    P(win) model arbitrates): bench-neutral (39.4/38.4 vs 39.3/38.6 refs).
    Shipped default-ON in AnvilSecondBot; killed in AnvilFirstBot.
- **buyOrBank** (anvilBot.ts): refines the anti-bank guard — buy_boxing
  scores +4 when a card rated >=2.5 above the best affordable sits within
  one banked turn's reach (observed live: bot bought Coppercloud@2 twice in
  a twin pair while Pierce@6 rotted in the market; Henry banked and won
  both). On AnvilFirst the bank verdict regressed -3.9pp vs Zoom — the old
  "save-for-6-cost" rejection replicating — so AnvilFirst keeps only the
  spend-guard. AnvilSecond (veto-arbitrated) keeps the full verdict.

NOTE the live-app asymmetry: session bots always sit at index 1, so the app
bot is ALWAYS AnvilSecondBot regardless of move order (dispatch is by
index). Bench results for AnvilFirst matter only bench-world; features for
the bot Henry faces belong in AnvilSecondBot. (The index-vs-move-order
dispatch question is a known open item.)

Final sanity: seat0 72.5% (exact revert), seat1 39.4%, both at reference.

## Iteration: model v3 + reward-aware bursts + buy-eliminate damp

From divergence run 3 (64 matches, 7k decisions, burst-equipped shadow):
- Mission SELECTION stayed the top gap (n=273, delta +0.117) — a MODEL
  feature gap, not a Henry leak (case study 1). **Featurizer v3** adds
  my/oppMinTierGap + first-reward-near flags (65 features). Held-out:
  74.2% -> **78.0% acc, AUC 0.864**.
- buy_eliminate tell: Henry advancing where the bot wanted buy_eliminate =
  96% Henry win rate (n=74). **buyElimDamp=0.75** on AnvilSecond
  (bench-neutral; the bias only loses vs Henry-style play).
- Henry's fresh-mission money-tier line ("dump the turn into an unstarted
  mission, collect the M tier, buy the bomb"): **burst targets are now
  reward-weighted** (M/A/T/C/perm rewards + first-to-tier contents) so the
  solver proposes those chains; the veto judges them.
- **Era-ladder replay**: bot feature ships orphan earlier recordings; replay
  now retries with per-era configs (burst/bankVerdict/damp off) before the
  SquashV2 fallback. Coverage 33 -> 72 matches. Remaining loss = veto-model
  version drift (accepted). value_weights.v2-61feat.json kept for reference.

Post-burst-ship live signal (27 games): bot maxBurst 6.34 -> 7.15; Henry
responded 8.86 -> 9.93 and won 11/12 moving first. The arms race is the
data engine working as designed.

All gates at reference: seat1 39.1/38.8, seat0 72.5 exact, Squash flip 66.3.

## The phase-0 veto bug (2026-08-20, from a live game): "did nothing on turn 1"

Henry, playing Elend and going second, watched Anvil open with `Played 3
fundings | End actions | Traded 2 money -> 1 boxing` — two Trainings left
unburned, the whole turn passed.

Cause: [finishTurnAndEvaluate](anvilBot.ts) only reaches the postOppTurn=1
boundary when the opponent is a `SquashBot`; against a human `WebPlayer` it
falls back to the own-turn-end phase (postOppTurn=0). **Every live game takes
that fallback** — and the veto was never validated there. At phase 0 the
model cannot see what the untaken turn costs, and it prefers the untouched
board: on the reported opening it scored "end now" at P=0.716 against P=0.628
for a turn that advanced a mission, dealt 2 damage and banked a boxing —
strictly better on every feature that differed. Single-feature probe: the
biggest driver is `myFirstRewardNear` 0 -> 1, worth **-5.7pp** on its own
(the v3 mission-proximity features carry an inverted correlational response).

Measured on 296 seeded openings, bot in seat 1 moving first (the live app's
setup whenever Henry goes second — `useGame` pins the human to seat 0 and
passes `firstPlayer: 1`):

| bot char | turn-1 turns with no burn/flare |
|---|---|
| Kelsier, Prodigy (trained seat-1 policy) | 0/296 |
| Shan, Vin, Marsh | 65-102/296 |
| Empress, Zane, Kar, Elend (untrained) | 51-55/296 |

Same openings against a simulatable opponent: **1/296**. The evolved knobs
mask it, which is why it surfaced on the expansion characters first.

**Fix — `phase0VetoMode = "keepTurn"`:** when the opponent's reply can't be
simulated, `end_actions` is dropped from the veto's candidate set. The veto
may still reorder the turn (all other candidates reach the same turn-end
boundary, so they stay comparable) but may not end it. Turning the veto off
entirely in the fallback was tried and is clearly worse — the veto earns its
keep even at phase 0; it is only its "stop now" verdicts that are garbage.

A/B vs Twonky (a real bot that is NOT a SquashBot, so it takes the same
fallback a human does), Anvil-Elend seat 1 moving first, 300 games/range:

| mode | seeds 90000 | seeds 50000 | turn-1 no-ops |
|---|---|---|---|
| full (pre-fix) | 62.0% | 64.0% | 16/300, 24/300 |
| **keepTurn (shipped)** | **63.0%** | **64.3%** | 1/300, 1/300 |
| off | 55.3% | 57.7% | 1/300, 1/300 |

Bot-vs-bot is untouched by construction (the gate only reads
`opp instanceof SquashBot`): vs Hulk all three modes return 26.0% and an
identical 15/1532 no-op count over 150 games. No bench needs re-running.

Open: the honest fix is data — `valueDataGen` only ever plays firstPlayer=0,
so seat 1 is always `movesSecond=1` in training, and the live app's seat-1
mover-first bot sits in a corner the model never saw. Forcing `movesSecond=1`
on that state also removes the pathology (0/296), which is a hint, not a fix.
Generating half the rows with firstPlayer=1 would let the veto run unrestricted
against humans.

## Iteration: deck thinning + reward-aware mission selection (Henry's E-mission finding)

Henry: "bots can't use trashing cards effectively; I won both seats by
climbing the eliminating mission (Canton) over the refreshing one (Skaa)."

**Measurement first — and a stats bug.** eliminatedCounts read 0 for bots in
ALL 210+ recorded games. Root cause: recording only happened in the session's
human-action diff; bot turns bypass it. FIXED at the engine level
(Player.eliminate records; session keeps only buy-eliminate attribution).
True numbers: bot ~3.7 deck-eliminations/game vs Henry ~8-9. Canton: Henry
avg rank 10.0, 79% winrate at tier>=5; bot 4.4 avg vs Henry (but ~7 vs bots
— partly REACTIVE avoidance: Henry dominates the race and oppLead penalties
push the bot off).

**Shipped (AnvilSecond, gates at reference 39.4/39.2 seat1, 72.5 seat0):**
- Recording fix (both players' eliminations now count).
- missionRewardBonus in scoreMissionAdvance: nearest uncrossed tier's reward
  CONTENTS valued (tierRewardWeight, funding-aware E, first-to-tier x0.7,
  distance-discounted, ThinningConfig.missionRewardScale=1.5). The heuristic
  scorer had never looked at what tiers pay.
- E-effect boost (+8 while >=2 Fundings), self-trasher buy boost (+2.5 at
  >=3 Fundings), burst-target E weighting.

**Honest effect size vs bots: ~nil** (elims 3.44->3.59/game, Canton flat,
wins 24->25/80). Score boosts don't create E opportunities; vs bots the
opportunity structure is unchanged. The mechanisms exist for the vs-Henry
dynamics (his games are the test). If his Canton edge persists, next lever
is the oppLead penalty interacting with reward-rich missions — the bot
concedes exactly the missions most worth contesting.

## Correction + commitment gradient (Henry's challenge)

RETRACTION: the previous section's "reactive avoidance" claim (Henry
dominates Canton, oppLead penalty pushes the bot off) was WRONG. Henry
challenged it; the data agrees with him:
- Early (t<=7) total-mission leads are even (bot 65 / Henry 76 / even 69).
- The bot's LAST Canton advance happens while it is AHEAD more often than
  behind (23 vs 19) — abandonment, not pressure.
- Final-rank histograms: Henry is bimodal (0 or 12; 47/68 completions);
  the bot smears across ranks 1-6 with 26 never-starteds. Mechanism: after
  a tier crossing the proximity bonus vanishes and any mission with a
  closer tier outbids continuing — "closest tier wins" dithering.

SHIPPED: commitment gradient in AnvilSecond.scoreMissionAdvance —
+ThinningConfig.commitScale (1.0) x own rank on the mission, so invested
progress raises the priority of finishing (echoes the campaign-one lesson:
commitment > accuracy). Bench-neutral vs bots (32/80 both configs; gates
39.x/38.9 seat1, 72.5 seat0 exact) — like the rest of the thinning suite,
the dynamics it targets only express against Henry-style commit-and-finish
opponents. His games are the test.
