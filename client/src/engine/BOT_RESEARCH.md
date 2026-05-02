# Bot Research — Stronger Game-Playing Agents

Survey of how strong bots are built for similar games (Dominion, Hearthstone, Magic, chess), and what specifically applies to Squash/Zoom. Companion to [BOT_NOTES.md](BOT_NOTES.md), which documents what's been tried in this codebase.

Squash plateaus at **73.7%** (single-step action scoring + self-play correlations). Zoom plateaus at **33-37%** as second player vs Squash first. Both ceilings are structural — the literature is clear on what comes next.

## TL;DR — recommended path off the plateau

In priority order:

1. **1-ply lookahead with truncated flat MCTS, leaf-scored by existing eval.** Don't roll out to end of game. Keep the existing eval; snapshot/restore at the `Game` level; for top-K candidate actions, simulate one step and score the resulting state. Estimated +5-10pp, matches BOT_NOTES.
2. **Truncate rollouts at end-of-turn rather than end-of-game.** Convergent finding across Spades, Hearthstone, and Lord-of-the-Rings card-game research. Long games make terminal rollouts noisy; the heuristic eval is the right leaf scorer.
3. **Co-evolved per-character buy menus** (Provincial-style) to fix the "stuck below buy buffer → no self-play data" pathology.
4. **For Zoom specifically:** add lookahead before adding strategy. The seat-2 gap looks like a Stockfish-vs-Leela situation — a fast lookahead that *verifies* the anti-correlated line wins this state will close more of the gap than smarter heuristics.

The chess-engine principle — *speed of evaluation beats brilliance of evaluation* — applies. A fast 1-ply lookahead reusing the current eval will likely outperform a slow learned value net for a long time.

## What strong deck-builder bots actually do

### Provincial (Dominion, ~10 years state of the art)

Provincial is **not** an MCTS bot. It's competitive co-evolution over an ordered "buy menu" representation:

- An ordered list of `(card, count)` pairs
- Play rule: "buy the leftmost card you can afford"
- Separate threshold model for when to start buying victory cards
- Strategies tournament against each other; top performers seed the next generation's mutations
- Per-kingdom strategies — millions of self-play games per training cycle
- Action play is comparatively simple even in their strongest bot

**Two takeaways for Squash:**

1. **Kingdom-specific adaptation beats general heuristics.** `BASE_BUFFERS` per character is a weak version of this. A fully evolved per-character (ideally per-character-pair) buy menu is much richer.
2. **Most leverage is in *what you buy*, not *what you play*.** Matches the BOT_NOTES finding that self-play data on card values was the single biggest lever (+10%, 48% → 62%).

### DQN-bot (Wang et al., AAAI 2024 "Dominion: A New Frontier")

Beats Provincial ~2/3 of games using a tiny **2×256 MLP** for buy decisions, while inheriting Provincial's heuristics for action plays.

- Hybrid pattern (NN for acquisition, heuristic for play) is the going approach
- Struggles vs engine decks — exact same shape as Squash's "Obligator stuck below buy buffer, never gets self-play data" pathology
- Modest network size is notable: massive nets are not required to beat the prior state of the art

### Hearthstone (peter1591, alphastone, ResNet variants)

Combines **PIMC + ISMCTS** with a NN as the *rollout default policy*. Critical numbers from the paper:

- Random rollouts: 300k iterations to find certain plays
- NN-guided rollouts: <15k iterations for the same plays
- ~20× speedup from a strong default policy

For Squash, the existing scoring function would make an excellent default policy. Random rollouts in deck-builders are catastrophic — most random sequences end the turn early without using metals or advancing missions, polluting the value estimate.

### Magic: The Gathering drafting (Ward, 2020)

DNN > naive Bayes > expert-tuned heuristic > simple heuristic. Drafting is closer to a single-decision problem than full play, so less directly transferable, but confirms learned models beat hand-tuned at sufficient data scale.

## MCTS variant choice for imperfect-info card games

BOT_NOTES lists "MCTS rollouts" as a single bullet, but the variant choice is non-trivial. All four are studied in the card-game literature.

| Variant | What it does | Risk for Mistborn |
|---|---|---|
| **Determinized UCT (PIMC)** | Sample N possible deck/hand states, run perfect-info MCTS on each, vote on best move | "Strategy fusion": agent searches as if it can see hidden cards, picks moves that only work in one state. Bad for cards whose value depends on what's left in deck (basically every Mistborn card). |
| **Information Set MCTS (ISMCTS)** | Single tree where nodes are information sets, not states | Theoretically right for Mistborn. More complex to implement. Standard in modern card-game literature (Cowling/Powley/Whitehouse 2012). |
| **Flat MCTS** | No tree — sample K rollouts per top-level action, average | Cheap, surprisingly effective when heuristic eval is strong. Reasonable first step before full ISMCTS. |
| **MCTS-minimax hybrid** | MCTS for global decisions, alpha-beta for tactical sub-trees | Useful where there's a small "kill phase" that can be searched exactly (Hearthstone uses this for attack assignment; Mistborn could use it for damage routing when opp HP ≤ X). |

**Recommendation for Squash:** flat MCTS with rollouts truncated at end-of-turn, leaf-scored by the existing eval. This matches what the AI Factory Spades bot and mid-game Hearthstone agents do. Full rollouts to terminal in 30-turn deck-builders are too noisy — one early branch dominates the win/loss.

## Lessons from chess engines

Counterintuitive but well-established:

- **Stockfish (alpha-beta + NNUE) beats Leela (MCTS + 191M-param transformer) by ~200 Elo** because Stockfish evaluates ~1500× more positions per second.
- The principle: *"speed matters more than brilliance"* in games where deeper search compounds.
- NNUE = Efficiently Updatable Neural Network. Most chess moves only change a few squares, so the eval is updated incrementally rather than recomputed from scratch. +80-100 Elo overnight when introduced (2020).
- Move ordering is half the battle in alpha-beta. A good move-ordering heuristic dramatically prunes the tree.

**Translation for Mistborn:**

- A fast 1-ply lookahead reusing the existing eval will likely outperform a slow learned value net.
- Most actions in Mistborn modify state incrementally (one card moved, one resource changed). NNUE-style incremental eval would matter for any deep search — but is overkill at 1-ply.
- The existing scoring function is already a near-perfect move-ordering heuristic. Top-K from scoring → MCTS is the standard combo.

## AlphaZero — the loss function and the policy improvement framing

Even without running AlphaZero training, two ideas are worth borrowing:

**The loss function:**
```
L(θ) = (v − z)² − π·log(p) + c·‖θ‖²
```
where `z` is the *real* terminal outcome (not a TD bootstrap) and `π` is the MCTS-improved policy. Principled: don't bootstrap value targets in deep, sparse-reward games — propagate from terminals only. This is *why* the existing self-play correlation pipeline (which uses real terminal outcomes) is well-calibrated. Bootstrapping would have introduced the feedback loops BOT_NOTES already documents.

**The policy improvement operator framing:**
- Lookahead/MCTS produces a stronger policy than the network/heuristic alone
- Network/heuristic trains on lookahead targets
- Iterate

Right mental model for *any* lookahead added to Squash: the lookahead's choices become high-quality training data for a stronger scoring function in the next iteration.

## Common machinery used by every strong card-game bot

- **Move pruning before search.** All surveyed bots filter obviously-bad actions; Squash already does this implicitly via scoring. Top-K → MCTS is standard.
- **State abstraction.** Bucket equivalent states so search doesn't re-expand them. For Mistborn: `{deck composition signature, character, opp HP bucket, missions complete, victory path}` is a natural key.
- **Lethal / endgame solver.** Chess, Hearthstone, Magic all carve out a "tactical phase" solved exactly. For Mistborn: when opp HP ≤ N, exhaustively enumerate damage routings this turn before falling back to scoring.
- **Heuristic-guided rollouts.** Random default policy in card games is so weak it usually doesn't reach informative terminal states; learned/heuristic default policies cut iterations needed by ~20×.
- **Truncated rollouts + leaf eval.** Don't play to terminal in long games; play to a horizon and score with the eval.

## Specific application to current architecture

### For Squash (improving the 73.7% ceiling)

1. **Extract `_takeSnapshot` / `_restoreSnapshot` from `session.ts` to `Game`.** Already flagged in BOT_NOTES Zoom section. Required for any lookahead.
2. **1-ply flat MCTS:** for each candidate action from `scoreAction`, simulate it, score the resulting state, pick the action with the best simulated successor score. ~10× slower per move; expected +5-10pp.
3. **Top-K candidate filtering:** only the top 5-10 scored actions enter the lookahead. Squash's existing scoring is the move ordering.
4. **End-of-turn truncated rollouts** (one step beyond 1-ply): play out the rest of the turn under the existing scoring, then evaluate the post-turn state. Captures multi-action turn dynamics (burn → use → ally) that 1-ply misses.
5. **Lethal solver:** when opp HP ≤ ~10, exact-enumerate damage routings rather than scoring. Mistborn has a small enough damage-action space that exhaustive search is cheap.

### For Zoom (closing the seat-2 gap)

The 33-37% plateau is a Stockfish-vs-Leela situation in miniature. Don't add more strategy — add search.

1. **Same lookahead infrastructure as Squash.** A fast 1-ply lookahead lets Zoom *verify* the anti-correlated victory path actually wins from this specific state, rather than committing on a static prior.
2. **Search depth lets Zoom react to opp's actual moves**, which BOT_NOTES specifically called out as a structural weakness Squash-vs-Zoom exploits ("Squash playing first wins races by tempo regardless of Zoom's reaction").
3. **Per-matchup search depth budget** if needed: spend more rollouts in matchups where Zoom is weakest (Kelsier-1st, Shan-1st).

### For the buy-buffer pathology (cross-cutting)

Cards stuck below buy buffer never get bought, so self-play has no data, so rating never improves. BOT_NOTES Known Weakness #3.

- **Provincial-style co-evolution of buy menus** sidesteps this entirely: the GA explores by mutation, not by current scoring; cards get tried regardless of analytical rating.
- Cheaper interim: **occasional forced exploration in self-play** — every Nth game, force the bot to buy a specific underrated card and see what happens. Avoids the data-quality damage of pure ε-greedy noise (which BOT_NOTES already showed hurt: 70.6% → 68.6%).

## What *not* to do based on the literature

- **Pure random rollouts to terminal.** Catastrophic in long card games. Always use heuristic-guided + truncated.
- **Deep neural nets without first having lookahead.** Stockfish > Leela. A fast 1-ply lookahead with the existing eval should be tried before any value-net training.
- **Pure ε-greedy exploration in self-play data generation.** BOT_NOTES already confirmed this hurts; the literature on imitation learning in card games agrees (noisy demonstrations degrade learned policies more than they help coverage).
- **PIMC determinization without ISMCTS** in a game where most cards' values depend on hidden state. Strategy fusion is severe.

## Sources

- [Provincial: An AI for Dominion (Stanford)](https://graphics.stanford.edu/~mdfisher/DominionAI.html)
- [Dominion: A New Frontier for AI Research (arXiv 2024)](https://arxiv.org/html/2405.06846v1)
- [AIs for Dominion Using Monte-Carlo Tree Search (Goodwin)](https://www.semanticscholar.org/paper/An-AI-for-Dominion-Based-on-Monte-Carlo-Methods-Goodwin/28b6ada13e948cfaee4af5138ee667d404eb01ac)
- [Information Set Monte Carlo Tree Search (Cowling, Powley, Whitehouse, 2012)](https://eprints.whiterose.ac.uk/id/eprint/75048/1/CowlingPowleyWhitehouse2012.pdf)
- [Determinization and ISMCTS for Magic: The Gathering](http://orangehelicopter.com/academic/papers/cig11.pdf)
- [Improving Hearthstone AI by Combining MCTS and Supervised Learning (arXiv 1808.04794)](https://arxiv.org/pdf/1808.04794)
- [Mixing MCTS with Conventional Static Evaluation (AI Factory)](https://www.aifactory.co.uk/newsletter/2011_02_mcts_static.htm)
- [Mastering Chess and Shogi by Self-Play with AlphaZero (arXiv 1712.01815)](https://arxiv.org/pdf/1712.01815)
- [NNUE design principles (IJRIAS)](https://rsisinternational.org/journals/ijrias/articles/a-theoretical-analysis-of-the-development-and-design-principles-of-nnue-for-chess-evaluation/)
- [AI solutions for drafting in Magic: the Gathering (Ward, arXiv 2009.00655)](https://arxiv.org/pdf/2009.00655)
- [Strategy Card Game AI Competition summary (arXiv 2305.11814)](https://arxiv.org/pdf/2305.11814)
- [Monte-Carlo Tree Search and Minimax Hybrids with Heuristic Evaluation Functions (Maastricht)](https://dke.maastrichtuniversity.nl/m.winands/documents/mctshybrids.pdf)
- [Training an AI for the card game Dominion (Davis)](https://ianwdavis.com/dominion.html)
