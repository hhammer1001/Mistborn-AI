# Squash Bot — Tuning Notes

Notes from iterating on Squash Bot (originally named TwonkyV2) against the original Twonky. Current ceiling: **73.7%** win rate over 5000 games.

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
