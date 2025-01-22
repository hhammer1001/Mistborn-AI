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

    def __init__(self, numPlayers=2, charSelect=False,missions=sorted(random.sample(range(8), 3))):
        self.numPlayers = numPlayers
        self.characters = ['Kelsier', 'Shan', 'Vin', 'Marsh', 'Prodigy', ]
        self.charSelect = charSelect
        self.missions = missions
        self.player1 = None
        self.player2 = None
        self.player3 = None
        self.player4 = None
        self.trash = Deck('empty')
        self.cardAbilities = []
        self.market = []
         

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

    def __init__(self, start, owner, game):
        #TODO
        pass

    
    class Card():

        def __init__(self, name, cost, deck):
            self.name = name
            self.deck = deck
            self.cost = cost

        def play(self):
            for func, arg in self.deck.game.cardAbilities[self.name]:
                self.deck.owner.func(arg)
            



class Player():

    def __init__(self, gameName, turnOrder=1, name="B$", character='Kelsier'):
        self.name = name
        self.game = gameName
        self.character = character
        self.curDamage = 0
        self.curMoney = 0
        self.curBoxings = 0
        self.curHealth = 34 + 2 * turnOrder
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
        #TODO
        #probably just: print metals, input num, refresh chosen metal, but haven't decided how interface will look yet
        pass

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
        




test = Game()

pTest = test.Player()

pTest.missionFuncs[pTest.missionTiers['Canton Of Orthodoxy'][0][1]](pTest.missionTiers['Canton Of Orthodoxy'][0][2])
