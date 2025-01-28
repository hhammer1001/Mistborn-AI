import random
import csv
from deck import Deck
import card

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

        self.missionTiers = {"Canton Of Orthodoxy":[[5, 'E', 1, 'E', 1],[9, 'E', 1, 'E', 1],[12, 'E', 4, 'E', 1]], 
                                "Luthadel Garrison":[[4, 'D', 1, 'K', 1],[7, 'D', 2, 'K', 1],[10, 'D', 3, 'K', 1],[12, 'Pd', 2, 'D', 1]], 
                                "Keep Venture":[[4, 'M', 1, 'M', 1],[6, 'M', 1, 'M', 1],[8, 'M', 1, 'M', 1],[10, 'M', 1, 'M', 1],[12, 'Pm', 2, 'M', 3],], 
                                "Skaa Caverns":[[5, 'R', 1, 'R', 1],[9, 'R', 1, 'R', 1],[12, 'B', 1, 'R', 8]], 
                                "Pits Of Hathsin":[[4, 'M', 1, 'M', 1],[8, 'D', 2, 'H', 2],[12, 'A', 1, 'A', 1]], 
                                "Kredik Shaw":[[4, 'D', 1, 'D', 1],[8, 'D', 1, 'D', 1],[12, 'Pd', 2, 'D', 2]], 
                                "Crew Hideout":[[6, 'H', 4, 'H', 2],[12, 'H', 6, 'H', 2]], 
                                "Luthadel Rooftops":[[6, 'T', 1, 'T', 1],[12, 'T', 1, 'T', 1]]}
        self.numPlayers = numPlayers
        if randChars:
            self.characters = random.sample(['Kelsier', 'Shan', 'Vin', 'Marsh', 'Prodigy'], numPlayers)
        else:
            self.characters = chars
        self.missionNames = [sorted(list(self.missionTiers.keys()))[i] for i in sorted(random.sample(range(8), 3))]
        self.missions = [Mission(self.missionNames[i], self, self.missionTiers[self.missionNames[i]]) for i in range(3)]
        self.decks = [Deck(self.characters[i], self) for i in range(numPlayers)]
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
        self.trash = Deck('empty', self)
        self.cardAbilities = [] #TODO
        self.market = [] #TODO
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

    def __init__(self, name, game, tiers):
        self.name = name
        self.game = game
        self.tiers = self.game.missionTiers[name]
        self.playerRanks = [0 for i in range(game.numPlayers)]
        self.cutoffs = [x[0] for x in self.tiers]
        
    def progress(self, playerNum, amount):
        old = self.playerRanks[playerNum]
        # self.playerRanks[playerNum] += amount
        new = self.playerRanks[playerNum] + amount
        for tier in self.tiers:
            if old < tier[0] and new >= tier[0]:
                self.game.players[playerNum].missionFuncs[tier[1]](tier[2])
                if max(self.playerRanks) < tier[0]:
                    self.game.players[playerNum].missionFuncs[tier[3]](tier[4])
        self.playerRanks[playerNum] = new
    
    def display(self):
        return f"Progress on {self.name} is {self.playerRanks}, tiers are {self.tiers}"
        
class Player():

    def __init__(self, deck, gameName, turnOrder, name="B$", character='Kelsier'):
        self.name = name
        self.houseWarring = False
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
        self.turnOrder = turnOrder
        if self.curHealth > 40:
            self.curHealth = 40
            self.curBoxings = 1
        # self.missionTiers = {"Canton Of Orthodoxy":[[5, 'E', 1, 'E', 1],[4, 'E', 1, 'E', 1],[3, 'E', 4, 'E', 1]], 
        #                         "Luthadel Garrison":[[4, 'D', 1, 'K', 1],[3, 'D', 2, 'K', 1],[3, 'D', 3, 'K', 1],[2, 'Pd', 2, 'D', 1]], 
        #                         "Keep Venture":[[4, 'M', 1, 'M', 1],[2, 'M', 1, 'M', 1],[2, 'M', 1, 'M', 1],[2, 'M', 1, 'M', 1],[2, 'Pm', 2, 'M', 3],], 
        #                         "Skaa Caverns":[[5, 'R', 1, 'R', 1],[4, 'R', 1, 'R', 1],[3, 'B', 1, 'R', 8]], 
        #                         "Pits Of Hathsin":[[4, 'M', 1, 'M', 1],[4, 'D', 2, 'H', 2],[4, 'A', 1, 'A', 1]], 
        #                         "Kredik Shaw":[[4, 'D', 1, 'D', 1],[4, 'D', 1, 'D', 1],[4, 'Pd', 2, 'D', 2]], 
        #                         "Crew Hideout":[[6, 'H', 4, 'H', 2],[6, 'H', 6, 'H', 2]], 
        #                         "Luthadel Rooftops":[[6, 'T', 1, 'T', 1],[6, 'T', 1, 'T', 1]]}
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
        if self.houseWarring:
            self.mission(amount)
        else:
            self.curDamage += amount

    def money(self, amount):
        self.curMoney += amount

    def heal(self, amount):
        self.curHealth += amount
        if self.curHealth > 40:
            self.curHealth = 40

    def mission(self, amount):
        prog = 0
        for m in self.game.missions:
            print(m.display())
        while prog < amount:
            print("Enter in amounts to progress on the three missions:")
            while True:
                try:
                    first = int(input(f"Enter {self.game.missionNames[0]} amount: "))
                    if first < 0 or first > amount - prog:
                        raise ValueError("Negative or too high")
                    break
                except ValueError:
                    print("Invalid input. Please enter a positive integer that is not more than the remaining mission amount")
            prog += first
            while True:
                try:
                    second = int(input(f"Enter {self.game.missionNames[1]} amount: "))
                    if second < 0 or second > amount - prog:
                        raise ValueError("Negative or too high")
                    break
                except ValueError:
                    print("Invalid input. Please enter a positive integer that is not more than the remaining mission amount")
            prog += second
            while True:
                try:
                    third = int(input(f"Enter {self.game.missionNames[2]} amount: "))
                    if third < 0 or third > amount - prog:
                        raise ValueError("Negative or too high")
                    break
                except ValueError:
                    print("Invalid input. Please enter a positive integer that is not more than the remaining mission amount")
            prog += third
            if prog != amount:
                print(f"Enter in amounts that sum to {amount} please")
                prog = 0
        amounts = [first, second, third]
        for m in self.game.missions:
            m.progress(self.turnOrder, amounts[0])
            amounts = amounts[1:]
        


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
            if choice == -1 :
                break
            else:
                self.deck.eliminate(choice)
    
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

    def special1(self, amount):
        #investigate
        count = 0
        for m in self.game.missions:
            ranks = m.playerRanks
            ours = ranks[self.turnOrder]
            if ours > 0:
                lowest = [1,0]
                for i in range(len(ranks)):
                    if i > 0 and i < ours:
                        lowest[0] = 0
                    elif i > ours:
                        lowest[1] = 1
                if lowest == [1,1]:
                    count += 1
        self.money(count)

    def special2(self, amount):
        #Eavesdrop1
        for m in self.game.missions:
            ranks = m.playerRanks
            ours = ranks[self.turnOrder]
            if ours > 0:
                lowest = [1,0]
                for i in range(len(ranks)):
                    if i > 0 and i < ours:
                        lowest[0] = 0
                    elif i > ours:
                        lowest[1] = 1
                if lowest == [1,1]:
                    m.progress(self.turnOrder, 1)
    
    def special3(self, amount):
        #Lookout
        count = 0
        for m in self.game.missions:
            ranks = m.playerRanks
            ours = ranks[self.turnOrder]
            if ours > 0:
                highest = True
                for i in range(len(ranks)):
                    if i > ours:
                        highest = False
                if highest:
                    count += 1
        self.draw(count)


    def special4(self, amount):
        #Hyperaware
        count = 0
        for m in self.game.missions:
            ranks = m.playerRanks
            ours = ranks[self.turnOrder]
            if ours > 0:
                highest = True
                for i in range(len(ranks)):
                    if i > ours:
                        highest = False
                if highest:
                    count += 1
        self.damage(count*3)

    def special5(self, amount):
        #Coppercloud
        count = 0
        for m in self.game.missions:
            ranks = m.playerRanks
            ours = ranks[self.turnOrder]
            if ours > 0:
                highest = True
                for i in range(len(ranks)):
                    if i > ours:
                        highest = False
                if highest:
                    count += 1
        if count > 0:
            self.draw(1)


    def special6(self, amount):
        #House war tier 2
        self.houseWarring = True


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
        #negative code is for pierce tier 2 ability
        twice = False
        if amount < 0:
            amount = amount * -1
            twice = True
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
                if twice:
                    choice2 = int(input("Second (different) Card number to seek: "))
                    if choice2 not in range(len(choices)) or choice2 == choice:
                        raise ValueError("Choose a valid number")
                break
            except ValueError:
                print("Invalid input. Please choose a card number to seek")
        #TODO Play choice
        if twice:
            #TODO play choice2
            pass

        

    def takeDamage(self, amount):
        for card in self.deck.hand:
            if card.active[0] == "cloudP" and amount > 0 and card.active[1] > 0:
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

# test.players[0].seek(-5)

# for row in fixedLines:
#     print(row)
