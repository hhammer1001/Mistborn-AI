import { Player } from "./player";
import { Ally, Card } from "./card";
import { PlayerDeck, Market } from "./deck";
import { Mission } from "./mission";
import { MISSION_TIERS, ALL_MISSION_NAMES, METAL_NAMES } from "./types";

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

  constructor(opts: {
    names?: string[];
    numPlayers?: number;
    chars?: string[];
    playerFactories?: [PlayerFactory, PlayerFactory];
    testDeck?: boolean;
  } = {}) {
    const {
      names = ["Player 1", "Player 2"],
      numPlayers = 2,
      chars = ["Kelsier", "Shan"],
      playerFactories,
      testDeck = false,
    } = opts;

    this.numPlayers = numPlayers;
    this.testDeck = testDeck;
    this.market = new Market(testDeck);
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
      this.decks.push(new PlayerDeck(this.characters[i]));
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

  attack(player: Player) {
    const opp = this.players[(player.turnOrder + 1) % 2];
    for (const ally of opp.allies) {
      if (ally.defender) return; // Defender blocks direct attack
    }
    opp.takeDamage(player.curDamage);
    if (!opp.alive) {
      this.victoryType = "D";
      this.winner = player;
    }
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

    return g;
  }

  // ── Helpers ──

  private _pickRandomIndices(total: number, count: number): number[] {
    const indices = Array.from({ length: total }, (_, i) => i);
    // Fisher-Yates partial shuffle
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, count).sort((a, b) => a - b);
  }
}
