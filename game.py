import random
import csv
from deck import PlayerDeck, Market
import card
from mission import Mission
from player import Player
from robot import RandomBot, EliBot, QualityBot, FocusBot, HammerBot, Twonky, EmployedTwonky

""" Mission tier format [dist from last reward/start, reward func, amt, first player reward func, first player reward amt]"""

""" input formatting
while True:
    try:
        age = int(input("Enter your age: "))
        if age < 0:
            raise ValueError("Age cannot be negative")
        break
    except ValueError:
        print("Invalid input. Please enter a positive integer.")

while True:
    try:
        age = input(f"Discard {card} to prevent {card.active[1]} damage? Y/N")
        if age not in ['y', 'n', 'Y', 'N']:
            raise ValueError("Enter Y or N")
        break
    except ValueError:
        print("Invalid input. Please enter Y or N")
        pass
if ans in ['y', 'Y']:

"""


class Game():

    def __init__(self, names = ["Kaladin", 'Jasnah'], numPlayers=2, randChars=False, chars = ['Kelsier', 'Shan'], randos=False, analysisMode=False, bots=[], mults=[]):
        self.victoryType = ''
        self.market = Market(self)
        self.missionTiers = {"Canton Of Orthodoxy":[[5, 'E', 1, 'E', 1],[9, 'E', 1, 'E', 1],[12, 'E', 4, 'E', 1]], 
                                "Luthadel Garrison":[[4, 'D', 1, 'K', 1],[7, 'D', 2, 'K', 1],[10, 'D', 3, 'K', 1],[12, 'Pd', 2, 'D', 1]], 
                                "Keep Venture":[[4, 'M', 1, 'M', 1],[6, 'M', 1, 'M', 1],[8, 'M', 1, 'M', 1],[10, 'M', 1, 'M', 1],[12, 'Pm', 2, 'M', 3],], 
                                "Skaa Caverns":[[5, 'R', 1, 'R', 1],[9, 'R', 1, 'R', 1],[12, 'B', 1, 'R', 8]], 
                                "Pits Of Hathsin":[[4, 'M', 1, 'M', 1],[8, 'D', 2, 'H', 2],[12, 'A', 1, 'A', 1]], 
                                "Kredik Shaw":[[4, 'C', 1, 'C', 1],[8, 'C', 1, 'C', 1],[12, 'Pc', 2, 'C', 2]], 
                                "Crew Hideout":[[6, 'H', 4, 'H', 2],[12, 'H', 6, 'H', 2]], 
                                "Luthadel Rooftops":[[6, 'T', 1, 'T', 1],[12, 'T', 1, 'T', 1]]}
        self.metalCodes = ["pewter", "tin", "bronze", "copper", "zinc", "brass", "iron", "steel","atium"]
        self.numPlayers = numPlayers
        self.turncount = 0
        self.winner = None
        if randChars:
            self.characters = random.sample(['Kelsier', 'Shan', 'Vin', 'Marsh', 'Prodigy'], numPlayers)
        else:
            self.characters = chars
        self.missionNames = [sorted(list(self.missionTiers.keys()))[i] for i in sorted(random.sample(range(8), 3))]
        self.missions = [Mission(self.missionNames[i], self, self.missionTiers[self.missionNames[i]]) for i in range(3)]
        self.decks = [PlayerDeck(self, self.characters[i]) for i in range(numPlayers)]
        if mults:
            if bots:
                if bots[0]==bots[1]:
                    self.players = [bots[0](self.decks[0], self, 0, bots[0].__name__, self.characters[0], analysisMode=analysisMode),
                    bots[1](self.decks[1], self, 1, bots[1].__name__ + "2", self.characters[1], analysisMode=analysisMode)]
                else:
                    self.players = [bots[0](self.decks[0], self, 0, bots[0].__name__, self.characters[0], analysisMode=analysisMode, specialInput=mults),
                    bots[1](self.decks[1], self, 1, bots[1].__name__, self.characters[1], analysisMode=analysisMode, specialInput=mults)]
        else:
            if bots:
                if bots[0]==bots[1]:
                    self.players = [bots[0](self.decks[0], self, 0, bots[0].__name__, self.characters[0], analysisMode=analysisMode),
                    bots[1](self.decks[1], self, 1, bots[1].__name__ + "2", self.characters[1], analysisMode=analysisMode)]
                else:
                    self.players = [bots[0](self.decks[0], self, 0, bots[0].__name__, self.characters[0], analysisMode=analysisMode),
                    bots[1](self.decks[1], self, 1, bots[1].__name__, self.characters[1], analysisMode=analysisMode)]
        if not bots: 
            self.players = [Player(self.decks[i], self, i, names[i], self.characters[i]) for i in range(numPlayers)]
        for i in range(numPlayers):
            self.decks[i].cleanUp(self.players[i])

    def play(self):
        currCharacter = 0
        while not self.winner:
            # for player in self.players:
            #     cards = sorted(player.deck.hand + player.deck.cards + player.deck.discard, key=lambda x: x.name)
            #     print(len(cards), cards)
            self.turncount += 1
            if self.turncount > 1000:
                print("long aaaa game")
                self.victoryType = 'T'
                return self.players[1]
            self.players[currCharacter].playTurn(self)
            currCharacter = (currCharacter + 1) % self.numPlayers
        return self.winner

    def missionVictoryCheck(self, playerNum):
        c = 0
        for mission in self.missions:
            # print(mission.playerRanks[playerNum])
            if(mission.playerRanks[playerNum] == 12):
                c = c + 1 
        if c == 3:
            self.victoryType = 'M'
            self.winner = self.players[playerNum]

    def attack(self, player):
        opp = self.players[(player.turnOrder + 1)%2]
        for ally in opp.allies:
            if ally.defender:
                return
        opp.takeDamage(player.curDamage)
        if not opp.alive:
            self.victoryType = 'D'
            self.winner = player

    def validTargets(self, player, ignoreDefender = False):
        opp = self.players[(player.turnOrder + 1)%2]
        defenders = []
        targets = []
        finalTargets = []
        if ignoreDefender:
            return opp.allies, opp
        for ally in opp.allies:
            if ally.defender:
                defenders += [ally]
        if defenders == []:
            targets = opp.allies
        else: 
            targets = defenders
        for target in targets: #TODO yell at Eli
            if player.curDamage >= target.health:
                finalTargets.append(target)
        return finalTargets, opp

    def senseCheck(self, player):
        opp = self.players[(player.turnOrder + 1)%2]
        return opp.senseCheck()

    def __repr__(self):
        ret = f"{str(self.market)}"
        for player in self.players:
            ret += "\n"
            ret += f"{str(player)}"
        return ret

def main():
    g = Game()
    winner = g.play()
    print(f"The winner is {winner}!!!!!")

if __name__ == '__main__':
    main()