import random
import csv
from deck import PlayerDeck, Market
import card
from mission import Mission
from player import Player

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

    def __init__(self, names = ["Kaladin", 'Jasnah'], numPlayers=2, randChars=False, chars = ['Kelsier', 'Shan']):

        self.missionTiers = {"Canton Of Orthodoxy":[[5, 'E', 1, 'E', 1],[9, 'E', 1, 'E', 1],[12, 'E', 4, 'E', 1]], 
                                "Luthadel Garrison":[[4, 'D', 1, 'K', 1],[7, 'D', 2, 'K', 1],[10, 'D', 3, 'K', 1],[12, 'Pd', 2, 'D', 1]], 
                                "Keep Venture":[[4, 'M', 1, 'M', 1],[6, 'M', 1, 'M', 1],[8, 'M', 1, 'M', 1],[10, 'M', 1, 'M', 1],[12, 'Pm', 2, 'M', 3],], 
                                "Skaa Caverns":[[5, 'R', 1, 'R', 1],[9, 'R', 1, 'R', 1],[12, 'B', 1, 'R', 8]], 
                                "Pits Of Hathsin":[[4, 'M', 1, 'M', 1],[8, 'D', 2, 'H', 2],[12, 'A', 1, 'A', 1]], 
                                "Kredik Shaw":[[4, 'D', 1, 'D', 1],[8, 'D', 1, 'D', 1],[12, 'Pd', 2, 'D', 2]], 
                                "Crew Hideout":[[6, 'H', 4, 'H', 2],[12, 'H', 6, 'H', 2]], 
                                "Luthadel Rooftops":[[6, 'T', 1, 'T', 1],[12, 'T', 1, 'T', 1]]}
        self.metalCodes = ["pewter", "tin", "bronze", "copper", "zinc", "brass", "iron", "steel"]
        self.numPlayers = numPlayers
        self.winner = None
        if randChars:
            self.characters = random.sample(['Kelsier', 'Shan', 'Vin', 'Marsh', 'Prodigy'], numPlayers)
        else:
            self.characters = chars
        self.missionNames = [sorted(list(self.missionTiers.keys()))[i] for i in sorted(random.sample(range(8), 3))]
        self.missions = [Mission(self.missionNames[i], self, self.missionTiers[self.missionNames[i]]) for i in range(3)]
        self.decks = [PlayerDeck(self.characters[i], self) for i in range(numPlayers)]
        self.players = [Player(self.decks[i], self, i, names[i], self.characters[i]) for i in range(numPlayers)]
        # self.p1Deck = Deck(self.characters[0], self)
        # self.player1 = Player(self.p1Deck, self, 0, names[0], self.characters[0])
        # self.p2Deck = Deck(self.characters[1], self)
        # self.player2 = Player(self.p2Deck, self, 1, names[1], self.characters[1])
        # if self.numPlayers > 2:
        #     self.p3Deck = Deck(self.characters[2], self)
        #     self.player3 = Player(self.p3Deck, self, 2, names[2], self.characters[2])
        # if self.numPlayers > 3:
        #     self.p4Deck = Deck(self.characters[3], self)
        #     self.player4 = Player(self.p4Deck, self, 3, names[3], self.characters[3])
        self.trash = []
        self.cardAbilities = [] #TODO
        self.market = Market(self)

         

    def start(self, names):
        players = []
        for i in range(self.numPlayers):
            if self.charSelect:
                char = ""
                while char not in self.characters:
                    char = input(f"What character? Choices are: {self.characters}")
            else:
                char = random.choice(self.characters)
            players += [self.Player(names[i],char)]

    def play(self):
        currCharacter = 0
        while not self.winner:
            self.players[currCharacter].playTurn(self)
            currCharacter = (currCharacter + 1) % self.numPlayers
        return self.winner
    def attack(self, player):
        opp = self.players[(player.turnOrder + 1)%2]
        for ally in opp.allies:
            if ally.taunt:
                return
        opp.takeDamage(player.curDamage)
    def validTargets(self, player):
        opp = self.players[(player.turnOrder + 1)%2]
        taunters = []
        targets = []
        for ally in opp.allies:
            if ally.taunt:
                taunters += [ally]
        if taunters == []:
            targets = opp.allies
        else: 
            targets = taunters
        for target in targets:
            if player.curDamage < target.health:
                targets.remove(target)
        return targets, opp
    def senseCheck(self, player):
        opp = self.players[(player.turnOrder + 1)%2]
        return opp.senseCheck()
    def __repr__(self):
        return f"{str(self.market)}"


# test = Game()

# pTest = test.Player()

# pTest.missionFuncs[pTest.missionTiers['Canton Of Orthodoxy'][0][1]](pTest.missionTiers['Canton Of Orthodoxy'][0][2])
# test = [1,2,3]
# print(test[:3]+test[:5])
# deckInfo = {0:[], 1:[], 2:[]}
# with open('starterdecks.csv', newline='') as csvfile:
#     lines = csv.reader(csvfile, delimiter=',', quotechar='|')
#     fixedLines = []
#     for row in lines:
#         print(row)
#         deckInfo[int(row[0])] += row[1:]
# print(fixedLines)
def main():
    g = Game()
    print(g)
# test.players[0].seek(-5)

# for row in fixedLines:
#     print(row)
if __name__ == '__main__':
    main()