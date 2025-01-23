import random
import csv

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

    def __init__(self, names = ["Kaladin", 'Jasnah'], numPlayers=2, randChars=False, chars = ['Kelsier', 'Shan'], ):
        self.numPlayers = numPlayers
        if randChars:
            self.characters = random.sample(['Kelsier', 'Shan', 'Vin', 'Marsh', 'Prodigy'], numPlayers)
        else:
            self.characters = chars
        self.missions = sorted(random.sample(range(8), 3))
        self.p1Deck = Deck(self.characters[0], self)
        self.player1 = Player(self.p1Deck, self, 0, names[0], self.characters[0])
        self.p2Deck = Deck(self.characters[1], self)
        self.player2 = Player(self.p2Deck, self, 1, names[1], self.characters[1])
        if self.numPlayers > 2:
            self.p3Deck = Deck(self.characters[2], self)
            self.player3 = Player(self.p3Deck, self, 2, names[2], self.characters[2])
        if self.numPlayers > 3:
            self.p4Deck = Deck(self.characters[3], self)
            self.player4 = Player(self.p4Deck, self, 3, names[3], self.characters[3])
        self.trash = Deck('empty', self)
        self.cardAbilities = [] #TODO
        self.marketDeck = [] #TODO
        # self.market = self.marketDeck.flip(6) #TODO
         

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

    def __init__(self, code, gameName):
        self.game = gameName
        self.hand = []
        self.cards = []
        if code in ['Kelsier', 'Shan']:
            for c in deckInfo[0]:
                data = cardLookup[c]
                self.cards += [Card(c, data, self)]
        elif code in ['Vin', 'Marsh', 'Prodigy']:
            pass
        
        self.discard = []
        self.inPlay = []

    def __repr__(self):
        out = self.cards + self.discard + self.hand + self.inPlay
        return str(out)

    def flip(self):
        for x in range(6-len(self.game.market)):
            newCard = self.draw(1)[0]
            self.game.market += [newCard]
            print(f"{newCard} added to market")
    
    def draw(self, amount):
        out = []
        for i in range(amount):
            if self.cards == []:
                self.discard = self.cards
                random.shuffle(self.cards)
                if self.cards == []:
                    pass
            out += [self.cards.pop(0)]
        return out


class Card():

    def __init__(self, name, data, deck):
        #data = [Cost,metal code,ability 1,abil 1 amt,ability 2,abil 2 amt,ability 3,abil 3 amt,activ abil,activ amt,burn abil,burn amt]
        self.name = name
        self.deck = deck
        self.cost = data[0]
        self.metal = data[1]
        self.ability1 = [zip(data[2].split("."), data[3].split("."))]
        # self.ability1


    def play(self, owner):
        for func, arg in self.ability1:
            self.deck.owner.missionFuncs[func](int(arg))
        self.deck.inPlay += [self]
        #TODO

    def __repr__(self):
        return self.name
        
class Player():

    def __init__(self, deck, gameName, turnOrder, name="B$", character='Kelsier'):
        self.name = name
        self.alive = True
        self.allies = []
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
        self.allies = Deck('empty', gameName)
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
        for i in range(amount):
            h = len(self.deck.hand)
            p = len(self.deck.inPlay)
            d = len(self.deck.discard)
            print(f"Hand is {list(zip(range(h), self.deck.hand))}")
            print(f"Play is {list(zip(range(h,h+p), self.deck.inPlay))}")
            print(f"Discard is {list(zip(range(h+p,h+d+p), self.deck.discard))}")
            choices = self.deck.hand + self.deck.inPlay + self.deck.discard
            while True:
                try:
                    choice = int(input("Pick the number to eliminate, or put -1 to not eliminate"))
                    if choice not in range(-1,h+p+d):
                        raise ValueError("Not a valid choice")
                    break
                except ValueError:
                    print("Please enter a number shown or -1 to not eliminate")
                    pass
            if choice == -1:
                break
            elif choice < h:
                self.deck.hand = self.deck.hand[:choice] + self.deck.hand[choice+1:]
            elif choice < h+p:
                self.deck.inPlay = self.deck.inPlay[:choice-h] + self.deck.inPlay[choice-h+1:]
            else:
                self.deck.discard = self.deck.discard[:choice-h-p] + self.deck.discard[choice-h-p+1:]
    
    def draw(self, amount):
        self.deck.draw(amount)

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
        print(f"Market is {list(zip(range(len(choices)), choices))}")
        while True:
            try:
                choice = int(input("Card number to seek: "))
                if choice not in range(len(choices)):
                    raise ValueError("Choose a valid number")
                break
            except ValueError:
                print("Invalid input. Please choose a card number to seek")
        c.play()

    def takeDamage(self, amount):
        for card in self.deck.hand:
            if card.active[0] == "cloudP" and amount > 0:
                while True:
                    try:
                        ans = input(f"Discard {card} to prevent {card.active[1]} damage? Y/N")
                        if ans not in ['y', 'n', 'Y', 'N']:
                            raise ValueError("Enter Y or N")
                        break
                    except ValueError:
                        print("Invalid input. Please enter Y or N")
                        pass
                if ans in ['y', 'Y']:
                    amount = max(amount - card.active[1], 0)
        self.curHealth -= amount
        if self.curHealth <= 0:
            self.alive = False
                
        
    def playCard(self, card):
        card.play(self)




# test = Game()

# pTest = test.Player()

# pTest.missionFuncs[pTest.missionTiers['Canton Of Orthodoxy'][0][1]](pTest.missionTiers['Canton Of Orthodoxy'][0][2])
# test = [1,2,3]
# print(test[:3]+test[:5])
deckInfo = {0:[], 1:[], 2:[]}
cardLookup = {}
with open('starrterdecks.csv', newline='') as csvfile:
    lines = csv.reader(csvfile, delimiter=' ', quotechar='|')
    fixedLines = []
    for row in lines:
        # print(row)
        if len(row) > 1:
            row = [row[0] + row[1]]
        fix = row[0].split(",")
        fixedLines += [fix]
# print(fixedLines)
for row in fixedLines[1:]:
    deckInfo[int(row[0])] += [row[1]]
    cardLookup[row[1]] = row[2:]

test = Game()

print(test.p1Deck)


# for row in fixedLines:
#     print(row)
