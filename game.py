import random

""" Mission tier format [dist from last reward/start, reward func, amt, first player reward func, first player reward amt]"""

"""
while True:
    try:
        age = int(input("Enter your age: "))
        if age < 0:
            raise ValueError("Age cannot be negative")
        break
    except ValueError:
        print("Invalid input. Please enter a positive integer.")
"""


class Game():

    def __init__(self, names = ["Kaladin", 'Jasnah'], numPlayers=2, randChars=False, chars = ['Kelsier', 'Shan'], ):
        self.numPlayers = numPlayers
        if randChars:
            self.characters = random.sample(['Kelsier', 'Shan', 'Vin', 'Marsh', 'Prodigy'], numPlayers)
        else:
            self.characters = chars
        self.missions = sorted(random.sample(range(8), 3))
        self.player1 = Player(self, 0, names[0], self.characters[0])
        self.player2 = Player(self, 1, names[1], self.characters[1])
        if self.numPlayers > 2:
            self.player3 = Player(self, 2, names[2], self.characters[2])
        if self.numPlayers > 3:
            self.player4 = Player(self, 3, names[3], self.characters[3])
        self.trash = Deck('empty')
        self.cardAbilities = [] #TODO
        self.marketDeck = [] #TODO
        self.market = self.marketDeck.flip(6)
         

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

    def play():
        pass
            
class Mission():

    def __init__(self, name, tiers):
        self.name = name
        self.progress = 0
        self.tiers = tiers[name]
        self.distToNextTier = self.tiers[0]
        
    def progress(self, amount):
        self.progress += amount
        # if self.progress > self.distToNextTier:
        #     self.progress = self.progess - self.

class Deck():

    def __init__(self, start, owner, gameName):
        self.game = gameName
        #TODO
        pass



    def flip(self):
        for x in range(6-len(self.game.market)):
            newCard = self.draw(1)
            self.game.market += [newCard]
            print(f"{newCard} added to market")
    
    class Card():

        def __init__(self, name, cost, deck, active):
            self.name = name
            self.deck = deck
            self.cost = cost
            self.active = active

        def play(self):
            for func, arg in self.deck.game.cardAbilities[self.name]:
                self.deck.owner.func(arg)
            #TODO

        def __repr__(self):
            return self.name
        


class Player():

    def __init__(self, gameName, turnOrder, name="B$", character='Kelsier'):
        self.name = name
        self.game = gameName
        self.character = character
        self.curDamage = 0
        self.curMoney = 0
        self.curBoxings = 0
        self.curHealth = 36 + 2 * turnOrder
        self.pDamage = 0
        self.pMoney = 0
        self.pDraw = 0
        self.handSize = 5
        # self.deck = Deck(self.character, self, )
        # self.discard = Deck('empty')
        self.atium = 0
        self.allies = Deck('empty')
        self.metals = [0]*8
        self.burns = 1
        self.training = 0
        self.trainingRewards = {3:['B', 1], 5:[self.level, 1], 8:[self.level, 2], 9:['B', 1], 11:['A', 1], 13:[self.level, 3], 15:['B', 1], 16:['A', 1]}
        self.lvl = 0
        if self.curHealth > 40:
            self.curHealth = 40
            self.curBoxings = 1
        self.missionTiers = {"Canton Of Orthodoxy":[[5, 'E', 1, 'E', 1],[4, 'E', 1, 'E', 1],[3, 'E', 4, 'E', 1]], 
                                "Luthadel Garrison":[[4, 'D', 1, 'K', 1],[3, 'D', 2, 'K', 1],[3, 'D', 3, 'K', 1],[2, 'Pd', 2, 'D', 1]], 
                                "Keep Venture":[[4, 'M', 1, 'M', 1],[2, 'M', 1, 'M', 1],[2, 'M', 1, 'M', 1],[2, 'M', 1, 'M', 1],[2, 'Pm', 2, 'M', 3],], 
                                "Skaa Caverns":[[5, 'R', 1, 'R', 1],[4, 'R', 1, 'R', 1],[3, 'B', 1, 'R', 8]], 
                                "Pits Of Hathsin":[[4, 'M', 1, 'M', 1],[4, 'D', 2, 'H', 2],[4, 'A', 1, 'A', 1]], 
                                "Kredik Shaw":[[4, 'D', 1, 'D', 1],[4, 'D', 1, 'D', 1],[4, 'Pd', 2, 'D', 2]], 
                                "Crew Hideout":[[6, 'H', 4, 'H', 2],[6, 'H', 6, 'H', 2]], 
                                "Luthadel Rooftops":[[6, 'T', 1, 'T', 1],[6, 'T', 1, 'T', 1]]}
        self.missionFuncs = {'D': self.damage,
                                'M': self.money,
                                'H': self.heal,
                                'C': self.draw,
                                'E': self.eliminate,
                                'A': self.gainAtium,
                                'T': self.train,
                                'K': self.killAlly,
                                'R': self.refresh,
                                'B': self.extraBurn,
                                'Pc': self.permDraw,
                                'Pd': self.permDamage,
                                'Pm': self.permMoney}



    def charPower(self, tier):
        if tier == 1:
            if self.character == 'Kelsier':
                self.damage(2)
            elif self.character == 'Shan':
                self.money(2)
            elif self.character == 'Vin':
                self.damage(1)
                self.heal(1)
                self.curMoney(1)
            elif self.character == 'Marsh':
                self.money(2)
            

    def damage(self, amount):
        self.curDamage += amount

    def money(self, amount):
        self.curMoney += amount

    def heal(self, amount):
        self.curHealth += amount
        if self.curHealth > 40:
            self.curHealth = 40

    def mission(self, amount):
        pass
        #TODO

    def eliminate(self, amount):
        #TODO
        pass

    def draw(self, amount):
        #TODO
        pass

    def gainAtium(self, amount):
        self.atium += amount

    def train(self, amount):
        self.train += amount
        

    def killAlly(self, amount):
        #TODO
        pass

    def permDraw(self, amount):
        self.pDraw += amount

    def permMoney(self, amount):
        self.pMoney += amount

    def permDamage(self, amount):
        self.pDamage += amount

    def refresh(self, amount):
        print(self.metals)
        while True:
            try:
                choice = int(input("Metal number to refresh: "))
                if choice not in range(len(8)):
                    raise ValueError("Choose a valid number")
                break
            except ValueError:
                print("Invalid input. Please choose a metal number to refresh")
        if self.metals[choice] == 2:
            self.metals[choice] = 0
    def extraBurn(self, amount):
        self.burns += amount

    def level(self, tier):
        self.lvl = tier
        if self.lvl in self.trainingRewards:
            self.trainingRewards[self.lvl][0](self.trainingRewards[self.lvl][1])
        elif self.lvl > 20:
            self.gainAtium(1)

    def seek(self, amount):
        choices = []
        for c in self.game.market:
            if c.cost <= amount:
                choices += c
        print(list(zip(range(len(choices)), choices)))
        while True:
            try:
                choice = int(input("Card number to seek: "))
                if choice not in range(len(choices)):
                    raise ValueError("Choose a valid number")
                break
            except ValueError:
                print("Invalid input. Please choose a card number to seek")
        c.play()

    def 
        




test = Game()

pTest = test.Player()

pTest.missionFuncs[pTest.missionTiers['Canton Of Orthodoxy'][0][1]](pTest.missionTiers['Canton Of Orthodoxy'][0][2])
