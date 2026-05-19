import { Player, applyStartingHealth } from "./player";
import { Action, Ally, Card } from "./card";
import { PlayerDeck, Market } from "./deck";
import { Mission } from "./mission";
import { MISSION_TIERS, ALL_MISSION_NAMES, METAL_NAMES } from "./types";
import { Rng, randomSeed, subRng } from "./rng";

export type PlayerFactory = (
  deck: PlayerDeck,
  game: Game,
  turnOrder: number,
  name: string,
  character: string,
) => Player;

export class Game {
  victoryType = "";
  testDeck: boolean;
  market: Market;
  metalCodes = [...METAL_NAMES];
  numPlayers: number;
  turncount = 0;
  winner: Player | null = null;
  characters: string[];
  missionNames: string[];
  missions: Mission[];
  decks: PlayerDeck[];
  players: Player[];
  /** Root seed for this game. All RNG streams are derived from it via
   *  `subRng(seed, label)`. Persist this for replay. */
  seed: number;
  /** Stream used for mission picks and any future game-wide randomness.
   *  Independent of the market/initial-deck streams so consuming this
   *  more or less doesn't perturb the fixed initial orderings. */
  gameRng: Rng;
  /** Per-bot streams, indexed by player turnOrder. Bots that opt in read
   *  from these for exploration / tie-breaking. */
  botRngs: Rng[];
  /** Buffered deck events (ad-hoc draws + reshuffles) that the session
   *  drains into per-player logs after each action. Cleared by drain. */
  deckEvents: Array<{ type: "draw"; playerIndex: number; amount: number }> = [];
  /** K-effect ally kills enqueued during action resolution (mission first-
   *  reached `K` rewards, Assassinate / Coinshot ability 2, Maelstrom). The
   *  queue defers the actual `killAlly` call until a safe boundary so the
   *  session can intercept and prompt a human defender for cloudA, and so
   *  multi-target kills (Maelstrom) become a series of individually-saveable
   *  events rather than an atomic massacre.
   *
   *  `attackerIndex` lets the drain re-pick via the attacker's
   *  killEnemyAllyIn when the original target is already dead — needed for
   *  the rare case where multiple K rewards fire in one mission.progress
   *  call (e.g., bot crosses Luthadel Garrison tiers 4 and 7 in one
   *  advance). Bots' killEnemyAllyIn is deterministic, so both would
   *  queue the same target; without re-targeting, the second kill is a
   *  silent no-op compared to the old inline-kill semantics.
   *
   *  Self-play (Game.play()) drains inline via drainPendingKills() right
   *  after each performAction — behavior matches the pre-queue inline kill.
   *  Session-driven play drives the drain with pause checks for human
   *  defenders. */
  pendingKills: Array<{ attackerIndex: number; defenderIndex: number; targetAllyId: number }> = [];

  constructor(opts: {
    names?: string[];
    numPlayers?: number;
    chars?: string[];
    playerFactories?: [PlayerFactory, PlayerFactory];
    testDeck?: boolean;
    seed?: number;
    /** Seat index of the player who takes the first turn. Determines the
     *  going-second HP compensation. Self-play / benches default to 0
     *  (seat 0 first); GameSession passes through the user's choice. */
    firstPlayer?: number;
  } = {}) {
    const {
      names = ["Player 1", "Player 2"],
      numPlayers = 2,
      chars = ["Kelsier", "Shan"],
      playerFactories,
      testDeck = false,
      seed,
      firstPlayer = 0,
    } = opts;

    this.seed = seed ?? randomSeed();
    const marketRng = subRng(this.seed, "market");
    this.gameRng = subRng(this.seed, "game");
    this.botRngs = Array.from({ length: numPlayers }, (_, i) =>
      subRng(this.seed, `bot_${i}`),
    );

    this.numPlayers = numPlayers;
    this.testDeck = testDeck;
    this.market = new Market(testDeck, marketRng, this.gameRng);
    this.characters = [...chars];

    // Pick 3 missions. In test-deck mode, restrict to the 3 missions whose
    // top tier grants a permanent reward (Pd/Pm/Pc) — convenient for testing
    // permanent-reward visuals and mechanics.
    if (testDeck) {
      this.missionNames = ["Luthadel Garrison", "Keep Venture", "Kredik Shaw"];
    } else {
      const sortedIndices = this._pickRandomIndices(ALL_MISSION_NAMES.length, 3);
      this.missionNames = sortedIndices.map((i) => ALL_MISSION_NAMES[i]);
    }
    this.missions = this.missionNames.map(
      (name) => new Mission(name, this, MISSION_TIERS[name])
    );

    // Create decks
    this.decks = [];
    for (let i = 0; i < numPlayers; i++) {
      const initRng = subRng(this.seed, `p${i}_init`);
      this.decks.push(new PlayerDeck(this.characters[i], initRng, this.gameRng));
    }

    // Create players
    if (playerFactories) {
      this.players = [
        playerFactories[0](this.decks[0], this, 0, names[0], this.characters[0]),
        playerFactories[1](this.decks[1], this, 1, names[1], this.characters[1]),
      ];
    } else {
      this.players = [];
      for (let i = 0; i < numPlayers; i++) {
        this.players.push(new Player(this.decks[i], this, i, names[i], this.characters[i]));
      }
    }

    // Initial hand draw
    for (let i = 0; i < numPlayers; i++) {
      this.decks[i].cleanUp(this.players[i], this.market);
    }

    // Going-second HP compensation. Single source of truth lives in
    // applyStartingHealth — every code path that sets starting HP funnels
    // through there. See the helper for the rationale.
    applyStartingHealth(this.players, firstPlayer);
  }

  /** Run a full game loop (for bot-vs-bot). Returns the winner. */
  play(): Player {
    let currentPlayer = 0;
    while (!this.winner) {
      this.turncount += 1;
      if (this.turncount > 1000) {
        this.victoryType = "T";
        return this.players[1];
      }
      this.players[currentPlayer].playTurn(this);
      currentPlayer = (currentPlayer + 1) % this.numPlayers;
    }
    return this.winner;
  }

  missionVictoryCheck(playerNum: number) {
    let completed = 0;
    for (const mission of this.missions) {
      if (mission.playerRanks[playerNum] >= 12) completed++;
    }
    if (completed === 3) {
      this.victoryType = "M";
      this.winner = this.players[playerNum];
    }
  }

  /** Apply the attacker's damage to the opponent (or no-op if blocked by a
   *  defender ally). Returns any cloudP cards the opponent auto-consumed
   *  while taking damage — propagated up so the session can log them. */
  attack(player: Player): Action[] {
    const opp = this.players[(player.turnOrder + 1) % 2];
    for (const ally of opp.allies) {
      if (ally.defender) return []; // Defender blocks direct attack
    }
    const cloudsUsed = opp.takeDamage(player.curDamage);
    // Only claim the damage victory if no earlier-in-turn condition already
    // declared one. The bot can hit mission victory mid-turn (e.g. advances
    // its 3rd mission to 12) and then deal lethal damage in the same turn;
    // overwriting the mission win means resolveCloud's "survived → clear D"
    // path nukes a legitimate non-damage victory.
    if (!opp.alive && !this.winner) {
      this.victoryType = "D";
      this.winner = player;
    }
    return cloudsUsed;
  }

  /** Returns [killable targets, opponent] */
  validTargets(player: Player, ignoreDefender = false): [Ally[], Player] {
    const opp = this.players[(player.turnOrder + 1) % 2];
    if (ignoreDefender) {
      return [opp.allies.slice(), opp];
    }
    const defenders = opp.allies.filter((a) => a.defender);
    const targets = defenders.length > 0 ? defenders : opp.allies;
    const finalTargets = targets.filter((t) => player.curDamage >= t.health);
    return [finalTargets, opp];
  }

  senseCheck(player: Player): number {
    const opp = this.players[(player.turnOrder + 1) % 2];
    return opp.senseCheck();
  }

  /** Resolve the queued target for a kill request: if the original ally is
   *  still alive, use it; otherwise let the attacker's killEnemyAllyIn
   *  re-pick from currently-living opponent allies. Returns null when no
   *  valid target exists (skip the kill silently). Bots' killEnemyAllyIn
   *  is deterministic, so two queued K rewards in the same advance would
   *  otherwise reference the same target and silently waste the second
   *  kill — re-targeting here matches the old inline-kill behavior. */
  resolveKillTarget(req: { attackerIndex: number; defenderIndex: number; targetAllyId: number }): Ally | null {
    const defender = this.players[req.defenderIndex];
    const queued = defender.allies.find((a) => a.id === req.targetAllyId);
    if (queued) return queued;
    const attacker = this.players[req.attackerIndex];
    const [options] = this.validTargets(attacker, true);
    if (options.length === 0) return null;
    const choice = attacker.killEnemyAllyIn(options);
    if (choice === -1) return null;
    const newTarget = options[choice];
    req.targetAllyId = newTarget.id;
    return newTarget;
  }

  /** Apply every queued K-effect kill in order, then clear the queue. Each
   *  kill goes through the defender's `killAlly` so bot defenders still
   *  exercise their `cloudAlly` heuristic, and so Player.applyKillAlly's
   *  on-play undoes (Noble / Crewleader / Smoker) fire. Session-driven play
   *  calls this with pause checks woven in — see session._drainPendingKills. */
  drainPendingKills(): void {
    while (this.pendingKills.length > 0) {
      const req = this.pendingKills.shift()!;
      const target = this.resolveKillTarget(req);
      if (target) {
        const defender = this.players[req.defenderIndex];
        defender.killAlly(target);
      }
    }
  }

  toJSON(perspective: number | null = null) {
    return {
      turnCount: this.turncount,
      winner: this.winner?.name ?? null,
      victoryType: this.victoryType || null,
      metalCodes: this.metalCodes,
      market: {
        hand: this.market.hand.map((c) => c.toJSON()),
        deckSize: this.market.cards.length,
        discardSize: this.market.discard.length,
        discard: this.market.discard.map((c) => c.toJSON()),
      },
      missions: this.missions.map((m) => m.toJSON()),
      players: this.players.map((p) =>
        p.toJSON(perspective === null || p.turnOrder === perspective, perspective === null)
      ),
    };
  }

  /** Deep-clone for lookahead simulation. All cards, decks, missions, and
   *  players are new instances; mutations on the clone don't affect the
   *  original. Card `id`s are preserved to allow cross-reference lookups.
   *  Optional `playerFactory` lets callers swap Player subclasses (e.g. to
   *  use a scripted decision player during simulation). The factory must
   *  populate the new player's state — `copyPlayerState` from player.ts is
   *  the intended helper. */
  clone(playerFactory?: (original: Player, deck: PlayerDeck, newGame: Game, cardMap: Map<number, Card>) => Player): Game {
    const g = Object.create(Game.prototype) as Game;
    g.victoryType = this.victoryType;
    g.testDeck = this.testDeck;
    g.metalCodes = [...this.metalCodes];
    g.numPlayers = this.numPlayers;
    g.turncount = this.turncount;
    g.winner = null;
    g.characters = [...this.characters];
    g.missionNames = [...this.missionNames];
    g.seed = this.seed;
    g.gameRng = this.gameRng.clone();
    g.botRngs = this.botRngs.map((r) => r.clone());

    const cardMap = new Map<number, Card>();
    g.market = this.market.clone(cardMap);
    g.missions = this.missions.map((m) => m.clone(g));

    g.decks = this.decks.map((d) => d.clone(cardMap));
    g.players = this.players.map((p, i) => {
      const clonedDeck = g.decks[i];
      if (playerFactory) return playerFactory(p, clonedDeck, g, cardMap);
      return p.clone(g, clonedDeck, cardMap);
    });

    // Rewire winner reference if the game was already won.
    if (this.winner) {
      g.winner = g.players[this.winner.turnOrder];
    }

    g.deckEvents = this.deckEvents.map((e) => ({ ...e }));
    g.pendingKills = this.pendingKills.map((e) => ({ ...e }));

    return g;
  }

  // ── Helpers ──

  private _pickRandomIndices(total: number, count: number): number[] {
    const indices = Array.from({ length: total }, (_, i) => i);
    // Fisher-Yates partial shuffle
    for (let i = indices.length - 1; i > 0; i--) {
      const j = this.gameRng.nextInt(i + 1);
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, count).sort((a, b) => a - b);
  }
}
