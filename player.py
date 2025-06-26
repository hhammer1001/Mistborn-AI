import csv
from card import Funding, Ally, Action

class Player():

    def __init__(self, deck, game, turnOrder, name="B$", character='Kelsier'):
        self.name = name
        self.allies = []
        self.game = game
        self.character = character
        self.curHealth = 36 + 2 * turnOrder
        self.smoking = False
        
        self.pDamage = 0
        self.pMoney = 0
        self.handSize = 5
        
        self.deck = deck
        self.atium = 0
        self.allies = []
        self.metalTokens = [0]*9 #0 available 1 burned 2 flared previous turn 3 refreshed 4 flared this turn atium is just number of tokens used this turn
        self.metalAvailable = [0]*9 # for spending on actions
        self.metalBurned = [0]*9 # for ally/character abilities
        self.burns = 1
        self.training = 0
        self.trainingRewards = {3:['B', '1'], 9:['B', '1'], 11:['A', '1'], 15:['B', '1'], 16:['A', '1']}
        self.charAbility1 = True
        self.charAbility2 = True
        self.charAbility3 = True
        self.turnOrder = turnOrder
        self.alive = True

        self.curDamage = 0
        self.curMoney = 0
        self.curMission = 0
        self.curBoxings = 0

        if self.curHealth > 40:
            self.curHealth = 40
            self.curBoxings = 1
        
        with open('characters.csv', newline='') as csvfile:
            lines = csv.reader(csvfile, delimiter=',', quotechar='|')
            for row in lines:
                if row[0] == self.character:
                    self.ability1metal = row[1]
                    self.ability1effect = row[2]
                    self.ability1amount = row[3]

        self.missionFuncs = {'D': self.damage,
                                'M': self.money,
                                'H': self.heal,
                                'C': self.draw,
                                'E': self.eliminate,
                                'A': self.gainAtium,
                                'T': self.train,
                                'K': self.killEnemyAlly,
                                'R': self.refresh,
                                'B': self.extraBurn,
                                'Pc': self.permDraw,
                                'Pd': self.permDamage,
                                'Pm': self.permMoney,
                                'riot': self.riot,
                                'Mi': self.mission, 
                                'seek': self.seek,
                                'pull': self.pull,
                                'push': self.push,
                                'special1': self.special1,
                                'special2': self.special2,
                                'special3': self.special3,
                                'special4': self.special4,
                                'special5': self.special5,
                                'special6': self.special6,
                                'special7': self.special7,
                                'special8': self.special8,
                                'special9': self.special9,
                                'special10': self.special10,
                                'special11': self.special11,
                                'special12': self.special12,
                                'special13': self.special13,
                                'special14': self.special14,
                                'special15': self.special15,
                                'special16': self.special16}
    def playTurn(self, game):
        # print(self.deck)
        self.resolve("T", "1")
        self.takeActions(game)
        self.assignDamage(game)
        game.attack(self)
        self.curDamage = self.pDamage

    def takeActions(self, game):
        # print(f"Current Player: {self.name}, Money: {self.curMoney}, Mission: {self.curMission}, Damage: {self.curDamage}")
        actions = self.availableActions(game)
        action = self.selectAction(actions, game)
        self.performAction(action, game)
        if action[0] != 0:
            self.takeActions(game)
    
    def assignDamage(self, game):
        targets, opp = game.validTargets(self)
        choice = self.assignDamageIn(targets)
        if(choice == -1):
            return
        else:
            self.curDamage -= targets[choice].health
            opp.killAlly(targets[choice])
            self.assignDamage(game)
    
    def assignDamageIn(self, targets):
        if targets == []:
            return -1
        for i, target in enumerate(targets):
            print(f"{i}: kill your opponent's {target}") 
        print("-1: deal remaining damage to your opponent")
        while True:
            try:
                choice = int(input("Enter the number assosciated with your chosen target"))
                if choice not in range(-1,len(targets)):
                    raise ValueError("Not a valid choice")
                break
            except ValueError:
                print("Please make a valid choice")
                pass
        return choice


    def selectAction(self, actions, game):
        for i, action in enumerate(actions):
            match action[0]:
                case 0:
                    print(f"{i}: move to damage")
                case 1:
                    print(f"{i}: advance mission {action[1]}")
                case 2:
                    print(f"{i}: burn the card {action[1]} for {game.metalCodes[action[2]]}")
                case 3:
                    print(f"{i}: use {action[1]} to refresh {game.metalCodes[action[2]]}")
                case 4:
                    print(f"{i}: put metal towards the abilities of {action[1]}") 
                case 5:
                    if (self.metalTokens[:-1].count(1) + self.metalTokens[-1]) < self.burns:
                        print(f"{i}: burn {game.metalCodes[action[1]]}") 
                    else:
                        print(f"{i}: flare {game.metalCodes[action[1]]}")
                case 6:
                    print(f"{i}: buy {action[1]}") 
                case 7:
                    print(f"{i}: buy {action[1]} and then eliminate it using it's first ability") 
                case 8:
                    print(f"{i}: use the first ability of your ally {action[1]}") 
                case 9:
                    print(f"{i}: use the second ability of your ally {action[1]}") 
                case 10:
                    print(f"{i}: use your first character ability") 
                case 11:
                    print(f"{i}: use your third character ability") 
                   
        while True:
            try:
                choice = int(input("Enter the number assosciated with your chosen Action: \n"))
                if choice not in range(0,len(actions)):
                    raise ValueError("Not a valid choice")
                break
            except ValueError:
                print("Please make a valid choice")
                pass
        return actions[choice]

    def resetToken(self, val):
        if val in [1,3]:
            return 0
        if val == 4:
            return 2
        return val
        
    def performAction(self, action, game):
        # print(action)
        match action[0]:
            case 0:
                self.curBoxings += self.curMoney // 2
                self.curMoney = self.pMoney
                self.curMission = 0
                self.metalTokens = list(map(self.resetToken, self.metalTokens))
                self.metalTokens[8] = 0
                self.metalAvailable = [0]*9
                self.metalBurned = [0]*9
                self.charAbility1 = True
                self.charAbility2 = True
                self.charAbility3 = True
                self.deck.cleanUp(self)
                for ally in self.allies:
                    ally.reset()

            case 1:
                sense = game.senseCheck(self)
                if sense > 0:
                    self.curMission -= sense
                else:
                    self.curMission += -1
                    action[1].progress(self.turnOrder, 1)
            case 2:
                action[1].burn(self)
                self.metalAvailable[action[2]] += 1
                self.metalBurned[action[2]] += 1
            case 3:
                action[1].burned = True
                if self.metalTokens[action[2]] == 4:
                    self.metalTokens[action[2]] = 3
                else:
                    self.metalTokens[action[2]] = 0
            case 4:
                if self.metalAvailable[action[1].metal] > 0:
                    self.metalAvailable[action[1].metal] -= 1
                    action[1].addMetal(self)
                else: 
                    self.metalAvailable[8] -= 1
                    self.metalBurned[action[1].metal] += 1
            case 5:
                if action[1] == 8:
                    self.metalTokens[8] += 1
                else: 
                    if (self.metalTokens[:-1].count(1) + self.metalTokens[-1]) < self.burns:
                        self.metalTokens[action[1]] = 1
                    else: 
                        self.metalTokens[action[1]] = 4
                self.metalAvailable[action[1]] += 1
                self.metalBurned[action[1]] += 1
            case 6:
                self.curMoney -= action[1].cost
                self.deck.discard += [action[1]]
                game.market.buy(action[1])
            case 7:
                self.curMoney -= action[1].cost
                self.charAbility2 = False
                game.market.discard += [action[1]]
                game.market.buy(action[1])
                action[1].ability1(self)
            case 8:
                action[1].ability1(self)
            case 9:
                action[1].ability2(self) 
            case 10:
                self.resolve(self.ability1effect, self.ability1amount)
                self.charAbility1 = False
            case 11:
                self.resolve("D.Mi", "3.3")
                self.charAbility3 = False 

    def senseCheck(self):
        for card in self.deck.hand:
            if card.data[10] == "sense":
                if self.senseCheckIn(card):
                    self.deck.hand.remove(card)
                    self.deck.discard += [card]
                    return card.data[11]
        return 0                   
    
    def senseCheckIn(self, card):
        while True:
            try:
                ans = input(f"Discard {card} to prevent {card.data[11]} mission? Y/N")
                if ans not in ['y', 'n', 'Y', 'N']:
                    raise ValueError("Enter Y or N")
                break
            except ValueError:
                print("Invalid input. Please enter Y or N")
                pass
        return (ans in ['y', 'Y'])

    def killEnemyAlly(self, amount = 0):
        options, opp = self.game.validTargets(self, ignoreDefender = True)
        choice = self.killEnemyAllyIn(options)
        if choice == -1 :
            return
        else:
            opp.killAlly(options[choice])
    
    def killEnemyAllyIn(self, allies):
        for i, ally in enumerate(options):
            print(f"{i}: {ally}")
        while True:
            try:
                choice = int(input("Pick the ally to kill or pick -1 to stop"))
                if choice not in range(-1,len(options)):
                    raise ValueError("Not a valid choice")
                break
            except ValueError:
                print("Please enter a number shown or -1 to not eliminate")
                pass
        return choice
    
    def killAlly(self, ally): 
        for card in self.deck.hand:
            if card.data[10] == "cloudA":
                if self.cloudAlly(card, ally):
                    self.deck.hand.remove(card)
                    self.deck.discard += [card]
                    return
        if(ally.data[0] == "Noble"):
            self.extraBurn(-1)
        if(ally.data[0] == "Crewleader"):
            self.permDraw(-1)
        if(ally.data[0] == "Smoker"):
            self.smoking = False
        self.allies.remove(ally)
        self.deck.discard += [ally]
    
    def cloudAlly(self, card, ally):
        while True:
            try:
                ans = input(f"Discard {card} to save {ally}?")
                if ans not in ['y', 'n', 'Y', 'N']:
                    raise ValueError("Enter Y or N")
                break
            except ValueError:
                print("Invalid input. Please enter Y or N")
                pass
        return (ans in ['y', 'Y'])


    def availableActions(self, game):
        #0 -> move to damage
        #1 -> advance mission
        #2 -> burn card
        #3 -> refresh with card
        #4 -> put a metal towards the abilities of card
        #5 -> burn/flare a metal
        #6 -> buy card
        #7 -> buy and elim card
        #8 -> use first ability of ally
        #9 -> use second ability of ally
        #10 -> use first character ability
        #11 -> use third character ability
        actions = [(0,)]
        if self.curMission > 0:
            for mission in game.missions:
                if mission.playerRanks[self.turnOrder]< 12:
                    actions += [(1, mission)]          
        for card in self.deck.hand:
            if isinstance(card, Funding):
                continue
            if not card.burned:
                if card.metalUsed == 0:
                    if card.metal == 8:
                        actions += [(2, card, 8)]
                    else:
                        actions += [(2, card, (card.metal//2)*2), (2, card, (card.metal//2)*2 + 1)]
                    if (card.metal == 8):
                        for i, token in enumerate(self.metalTokens):
                            if token in [2,4]:
                                actions += [(3, card, i)]
                    else:

                        if (self.metalTokens[(card.metal//2)*2] in [2,4]): 
                            actions += [(3, card, (card.metal//2)*2)]
                        if (self.metalTokens[((card.metal//2)*2) + 1] in [2,4]): 
                            actions += [(3, card, ((card.metal//2)*2) + 1)]
                if self.metalAvailable[card.metal] and card.metalUsed < card.capacity:
                    actions += [(4, card)]
        
        for metal, burned in enumerate(self.metalTokens[:-1]):
            if burned == 0:
                actions += [(5, metal)]
        if (self.atium > 0) and ((self.metalTokens[:-1].count(1) + self.metalTokens[8]) < self.burns):
            actions += [(5, 8)]
        for card in game.market.hand:
            if card.cost <= self.curMoney:
                actions += [(6, card)]
                if (self.training >= 8) and self.charAbility2 and isinstance(card, Action):
                    actions += [(7, card)]
        for ally in self.allies:
            if ally.available1:
                if self.metalBurned[ally.metal] > 0:
                    actions += [(8, ally)]
            if ally.available2: 
                if self.metalBurned[ally.metal] > 1: 
                    actions += [(9, ally)]
        if (self.charAbility1 and self.training >= 5) and self.metalBurned[int(self.ability1metal)] > 0:
            actions += [(10,)]
        if (self.charAbility3 and self.training >= 13) and self.metalBurned[8] > 0:
            actions += [(11,)]
        return actions

    def damage(self, amount):
        self.curDamage += amount

    def money(self, amount):
        self.curMoney += amount

    def heal(self, amount):
        self.curHealth += amount
        if self.curHealth > 40:
            self.curHealth = 40
    def mission(self, amount):
        self.curMission += amount

    def eliminate(self, amount):
        game = self.game
        for i in range(amount):
            choice = self.eliminateIn()
            if choice == -1 :
                break
            else:
                game.market.discard += [self.deck.eliminate(choice)]
    
    def eliminateIn(self):
        h = len(self.deck.hand)
        d = len(self.deck.discard)
        print(f"Hand is {list(zip(range(h), self.deck.hand))}")
        print(f"Discard is {list(zip(range(h+p,h+d+p), self.deck.discard))}")
        while True:
            try:
                choice = int(input("Pick the number to eliminate, or put -1 to not eliminate"))
                if choice not in range(-1,h+d):
                    raise ValueError("Not a valid choice")
                break
            except ValueError:
                print("Please enter a number shown or -1 to not eliminate")
                pass
        return choice
    
    def pull(self, amount):
        for i in range(amount):
            choice = self.pullIn()
            if choice == -1 :
                return
            else:
                self.deck.cards = [self.deck.discard[choice]] + self.deck.cards
                self.deck.discard = self.deck.discard[:choice] + self.deck.discard[choice:]
    
    def pullIn(self):
        for i, card in enumerate(self.deck.discard):
            print(f"{i}: {card}")
        while True:
            try:
                choice = int(input("Pick the number to pull to the top of your deck or pick -1 to stop"))
                if choice not in range(-1,len(self.deck.discard)):
                    raise ValueError("Not a valid choice")
                break
            except ValueError:
                print("Please enter a number shown or -1 to not pull")
                pass
        return choice
    
    def draw(self, amount):
        self.deck.draw(amount, self)

    def gainAtium(self, amount):
        self.atium += amount

    def train(self, amount):
        for i in range(amount):
            self.training += 1
            if self.training in self.trainingRewards:
                self.resolve(self.trainingRewards[self.training][0], self.trainingRewards[self.training][1])
            elif self.training > 20:
                self.gainAtium(1)

    def permDraw(self, amount):
        self.handSize += amount

    def permMoney(self, amount):
        self.pMoney += amount

    def permDamage(self, amount):
        self.pDamage += amount

    def special1(self, amount=0):
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

    def special2(self, amount=0):
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
    
    def special3(self, amount=0):
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
        self.draw(count, self)


    def special4(self, amount=0):
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

    def special5(self, amount=0):
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


    def special6(self, amount=0):
        #House war tier 2
        self.mission += self.damage
        self.damage = 0
    
    def special7(self, amount=0):
        #Dominate tier 2
        self.damage += self.mission
        self.mission = 0

    def special8(self, amount=0):
        #Subdue
        choices = []
        for card in self.game.market.hand:
            if card.cost <= 5:
                choices += [card]
        choice = self.subdueIn(choices)
        if choice == -1:
            return
        self.deck.discard += [choices[choice]]
        self.game.market.buy(choices[choice])

    def subdueIn(self, choices):
        if choices == []:
            return -1
        print(f"Choices are {list(zip(range(len(choices)), choices))}")
        while True:
            try:
                choice = int(input("Card number to choose: "))
                if choice not in range(len(-1, choices)):
                    raise ValueError("Choose a valid number")
                break
            except ValueError:
                print("Invalid input. Please choose a card number to gain")
        return choice

    def special9(self, amount=0):
        #Soar
        choices = list(filter(lambda x: x.cost <= self.curMoney, self.game.market.discard))
        choice = self.soarIn(choices)
        if choice == -1:
            return
        self.deck.discard += [choices[choice]]
        self.game.market.discard.remove(choices[choice])

    def soarIn(self, choices):
        if choices == []:
            return -1
        print(f"Choices are {list(zip(range(len(choices)), choices))}")
        while True:
            try:
                choice = int(input("Card number to buy or -1 to skip: "))
                if choice not in range(len(-1, choices)):
                    raise ValueError("Choose a valid number")
                break
            except ValueError:
                print("Invalid input. Please choose a card number to gain")
        return choice

    def special10(self, amount=0):
        #Precise Shot
        choices = []
        choices = self.game.market.discard
        choice = self.soarIn(choices)
        if choice == -1:
            return
        self.deck.discard += [choices[choice]]

    def special11(self, amount=0):
        for player in self.game.players:
            if player != self:
                allies = [a for a in player.allies]
                for ally in allies:
                    player.killAlly(ally)
        for i in range(6):
            self.market.buy(0)
    
    def special12(self, amount=0):
        #Confrontation1
        choices = []
        choices = self.game.market.discard
        choice = confrontationIn(choices)
        if choice == -1:
            return
        choices[choice].ability1(self)

    def confrontationIn(self, choices):
        print(f"Choices are {list(zip(range(len(choices)), choices))}")
        print("choose -1 to skip")
        while True:
            try:
                choice = int(input("Card number to choose: "))
                if choice not in range(-1, len(choices)):
                    raise ValueError("Choose a valid number")
                break
            except ValueError:
                print("Invalid input. Please choose a card number to gain")
        return choice

    
    def special13(self, amount=0):
        #Confrontation2
        self.game.winner = self

    def special14(self, amount=0):
        #Informant
        if len(self.deck.cards) > 0 and self.informantIn(self.deck.cards[0]):
            self.game.market.discard += [self.deck.cards[0]]
            self.deck.cards = self.deck.cards[1:]

    def informantIn(self, card):
        print(f"The top card of your deck is {card}")
        while True:
            choice = input("Do you want to Eliminate it? Y/N")
            if choice in ['y', 'Y', 'n', 'N']:
                break
        return (choice in ['y', 'Y'])

    def special15(self, amount=0):
        #Keeper
        if len(self.deck.hand) > 0:
            choices = self.deck.hand
            choice = self.keeperIn(choices)
            self.deck.setAside += [choices[choice]]
            self.deck.hand.remove(choices[choice])
            
        else:
            print("Your hand is empty")
    
    def keeperIn(self, choices):
        print(f"Choices are {list(zip(range(len(choices)), choices))}")
        while True:
            try:
                choice = int(input("Card number to choose: "))
                if choice not in range(len(choices)):
                    raise ValueError("Choose a valid number")
                break
            except ValueError:
                print("Invalid input. Please choose a card number to gain")
    
    def special16(self, amount=0):
        #seeker 2
        choice = list(filter(lambda x: x.sought, self.game.market.hand))
        if(choice != []):
            choice[0].ability1(self)


    def resolve(self, effect, amount):
        elist = effect.split('.')
        vlist = amount.split('.')
        for i in range(len(elist)):
            if elist[i] == "choose":

                self.choose(vlist[i])
            else:
                e = elist[i]
                v = int(vlist[i])
                self.missionFuncs[e](v)

    def choose(self, options):
        ops = options[1:-1].split('/')
        choice = self.chooseIn(ops)
        self.resolve(ops[2*choice], ops[2*choice + 1])
    
    def chooseIn(self, options):
        for i in range(len(ops) // 2):
            print(f"{i}: {ops[2*i]}, {ops[2*i + 1]}")
        while True:
            try:
                choice = int(input("Option to choose: "))
                if choice not in range(len(ops) // 2):
                    raise ValueError("Choose a valid number")
                break
                
            except ValueError:
                print("Invalid input.")
        return choice
    
    def refresh(self, amount):
        choice = self.refreshIn()
        if self.metalTokens[choice] == 2:
            self.metalTokens[choice] = 0
        if self.metalTokens[choice] == 4:
            self.metalTokens[choice] = 3
    
    def refreshIn(self):
        # print(self.game.metalCodes)
        while True:
            try:
                choice = int(input("Metal number to refresh: "))
                if choice not in range(8):
                    raise ValueError("Choose a valid number")
                break
            except ValueError:
                print("Invalid input. Please choose a metal number to refresh")
        return choice

    def push(self, amount = 1):
        choice = self.pushIn()
        if choice > -1:
            # print(choice)
            # print(self.game.market)
            self.game.market.discard += [self.game.market.hand[choice]]
            self.game.market.buy(self.game.market.hand[choice])
    def pushIn(self):
        for i, card in enumerate(self.game.market.hand):
            print(f"{i}: {card}")
        while True:
            try:
                choice = int(input("Press -1 to not push or choose a card to push"))
                if choice not in range(-1, 6):
                    raise ValueError("Choose a valid number")
                break
            except ValueError:
                print("Invalid input.")
        return choice

    def riot(self, amount):
        c = 0
        riotable = []
        for ally in self.allies:
            if ally.availableRiot:
                riotable += [ally]
        if(len(riotable) > 0):
            choice = self.riotIn(riotable)
            choice.riot(self)
        
    def riotIn(self, riotable):
        for i, ally in enumerate(riotable):
            print(f"{c}: {ally}")
        while True:
            try:
                choice = int(input("Ally to Riot: "))
                if choice not in range(c):
                    raise ValueError("Choose a valid number")
                break
            except ValueError:
                print("Invalid input.")
        return riotable[choice]

    def extraBurn(self, amount):
        self.burns += amount


    def seek(self, amount):
        #negative code is for pierce tier 2 ability or seeker tier 2
        seeker = False
        twice = False
        if amount == -6:
            amount = amount * -1
            twice = True
        elif amount == -5:
            amount = amount * -1
            seeker = True
        choices = []
        for c in self.game.market.hand:
            if c.cost <= amount and isinstance(c, Action):
                choices += [c]
        if choices == []:
            return 
        if len(choices) == 1:
            twice = False
        choice, choice2 = self.seekIn(twice, seeker, choices)
        if(choice > -1):
            choices[choice].ability1(self)
            if twice:
                choices[choice2].ability1(self)
            elif seeker:
                choices[choice].sought = True
    
        

    def seekIn(self, twice, seeker, choices):
        print(f"Market is {list(zip(range(len(choices)), choices))}")
        while True:
            try:
                choice = int(input("Card number to seek or -1 to not: "))
                if choice not in range(-1, len(choices)):
                    raise ValueError("Choose a valid number")
                if twice:
                    choice2 = int(input("Second (different) Card number to seek or -1 to not: "))
                    if choice2 not in range(-1, len(choices)) or choice2 == choice:
                        raise ValueError("Choose a valid number")
                    else:
                        choice2 = -1
                break
            except ValueError:
                print("Invalid input. Please choose a card number to seek")
        return choice, choice2
        
        

    def takeDamage(self, amount):
        for card in self.deck.hand:
            if card.data[10] == "cloudP":
                
                if cloudP(card):
                    amount = max(amount - card.active[1], 0)
                    self.deck.hand.remove(card)
                    self.deck.discard += [card]
        self.curHealth -= amount
        if amount > 0 and self.smoking:
            self.curHealth += 1
        if self.curHealth <= 0:
            self.alive = False

    def cloudP(self, card):
        while True:
            try:
                ans = input(f"Discard {card} to prevent {card.data[11]} damage? Y/N")
                if ans not in ['y', 'n', 'Y', 'N']:
                    raise ValueError("Enter Y or N")
                break
            except ValueError:
                print("Invalid input. Please enter Y or N")
                pass
        return (ans in ['y', 'Y'])
                
    def __repr__(self):
        return f"{self.name}: {self.curHealth}"