import type { MissionTierDef } from "./types";
import type { Game } from "./game";

export class Mission {
  name: string;
  tiers: MissionTierDef[];
  playerRanks: number[];
  /** Player who first reached the top tier of this mission. They remain
   *  "highest" for cards/abilities that check it (Lookout, Hyperaware) even
   *  if an opponent later ties them at the top. */
  topReachedBy: number | null = null;
  private game: Game;

  constructor(name: string, game: Game, tiers: MissionTierDef[]) {
    this.name = name;
    this.game = game;
    this.tiers = tiers;
    this.playerRanks = new Array(game.numPlayers).fill(0);
  }

  progress(playerNum: number, amount: number) {
    const oldRank = this.playerRanks[playerNum];
    const newRank = oldRank + amount;

    // If this advance completes the player's 3rd mission, the game is won the
    // moment we apply it. The tier rewards (which can throw interactive prompts
    // like refresh/eliminate) would then pop over an already-decided game, so
    // skip granting them entirely.
    const winsGame = this._completesThirdMission(playerNum, newRank);
    if (!winsGame) {
      for (const tier of this.tiers) {
        if (oldRank < tier.threshold && newRank >= tier.threshold) {
          // Grant tier reward
          this.game.players[playerNum].resolve(
            tier.reward,
            String(tier.rewardAmount)
          );
          // If this player is the first to reach this tier, grant first-player bonus
          if (Math.max(...this.playerRanks) < tier.threshold) {
            this.game.players[playerNum].resolve(
              tier.firstReward,
              String(tier.firstRewardAmount)
            );
          }
        }
      }
    }

    const topThreshold = this.tiers[this.tiers.length - 1]?.threshold ?? Infinity;
    if (this.topReachedBy === null && oldRank < topThreshold && newRank >= topThreshold) {
      this.topReachedBy = playerNum;
    }

    this.playerRanks[playerNum] = newRank;
    this.game.missionVictoryCheck(playerNum);
  }

  /** Would advancing this mission to `thisNewRank` give the player their 3rd
   *  completed mission (and thus win the game)? Mirrors Game.missionVictoryCheck:
   *  a mission counts as completed at rank >= 12. */
  private _completesThirdMission(playerNum: number, thisNewRank: number): boolean {
    const WIN_RANK = 12;
    if (thisNewRank < WIN_RANK) return false;
    let completed = 0;
    for (const mission of this.game.missions) {
      const rank = mission === this ? thisNewRank : mission.playerRanks[playerNum];
      if (rank >= WIN_RANK) completed++;
    }
    return completed >= 3;
  }

  clone(newGame: Game): Mission {
    const m = Object.create(Mission.prototype) as Mission;
    m.name = this.name;
    m.tiers = this.tiers;
    m.playerRanks = [...this.playerRanks];
    m.topReachedBy = this.topReachedBy;
    (m as unknown as { game: Game }).game = newGame;
    return m;
  }

  toJSON() {
    return {
      name: this.name,
      playerRanks: [...this.playerRanks],
      topReachedBy: this.topReachedBy,
      tiers: this.tiers.map((t) => ({
        threshold: t.threshold,
        reward: t.reward,
        rewardAmount: t.rewardAmount,
        firstReward: t.firstReward,
        firstRewardAmount: t.firstRewardAmount,
      })),
      maxRank: this.tiers.length > 0 ? this.tiers[this.tiers.length - 1].threshold : 12,
    };
  }
}
