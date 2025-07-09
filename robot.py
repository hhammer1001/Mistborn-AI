import csv
from card import Funding, Ally, Action
from player import Player
import random
import json

class RandomBot(Player):
    def assignDamageIn(self, targets):
        #choose the index of the ally to kill by assigning damage to it or return -1 to go to player damage
        return random.randint(0, len(targets)) - 1

    def selectAction(self, actions, game):
        #choose and return one of the actions in the list
        return random.choice(actions)
    
    def senseCheckIn(self, card):
        #return a bool to use the sense ability
        return random.random() > 0.5

    def killEnemyAllyIn(self, allies):
        #return the index of the ally to kill or -1 to not kill any
        return random.randint(0, len(allies)) - 1
    
    def cloudAlly(self, card, ally):
        #return a bool to discard card to save ally 
        return random.random() > 0.5
    
    def eliminateIn(self):
        #return the index of the card to be eliminated or -1 to not eliminate. Indexing goes hand, discard
        h = len(self.deck.hand)
        d = len(self.deck.discard)
        return random.randint(0, h + d) - 1
    
    def pullIn(self):
        #return the index of the card to be pulled or -1 to not pull.
        return random.randint(0,len(self.deck.discard)) - 1
        
    
    def subdueIn(self, choices):
        #return the index of the card to gain. All are options are valid targets -1 to pick nothing
        return random.randint(0,len(choices)) - 1
    
    def soarIn(self, choices):
        #return the index of the eliminated card to buy or -1 to not
        return random.randint(0,len(choices)) - 1

    def confrontationIn(self, choices):
        #return the index of the card to use it's first ability or -1 to not
        return random.randint(0,len(choices)) - 1
    
    def informantIn(self, card):
        #return a bool to decide if card is removed from top of deck
        return random.random() > 0.5

    def keeperIn(self, choices):
        #return the index of the card in play to be set aside
        return random.randint(0,len(choices)) - 1
    
    def chooseIn(self, options):
        #each effect takes two indices. for the first effect return 0, and for the second return 2 etc.
        k = (len(options) // 2) - 1
        return random.randint(0, k)
    
    def refreshIn(self):
        #return the index of the metal to refresh
        return random.randint(0,7)

    def pushIn(self):
        #return the index of the market card to push
        return random.randint(0, len(self.game.market.hand)) - 1
    
    def riotIn(self, riotable):
        #choose the ally from the list of valid allies to riot
        return random.choice(riotable)
    
    def seekIn(self, twice, seeker, choices):
        #im not going to try to explain this one... Henry I blame you for what's going on here
        choice = random.randint(-1, len(choices) - 1)
        if twice:
            choice2 = random.randint(-1, len(choices) - 2)
        else:
            choice2 = -1
        if choice == choice2 and choice > -1:
            choice2 += 1
        return choice, choice2
    
    def cloudP(self, card):
        #return a bool to decide if the card should be discarded to cloudp
        return random.random() > 0.5
        

class EliBot(Player):
    def __init__(self, deck, game, turnOrder, name="B$", character='Kelsier'):
        super().__init__(deck, game, turnOrder, name, character)
        self.killOnSight = ['Hazekillers', 'Soldier', 'Pewterarm']
    def assignDamageIn(self, targets):
        #choose the index of the ally to kill by assigning damage to it or return -1 to go to player damage
        for i, target in enumerate(targets):
            if target.name in self.killOnSight:
                return i
        return -1

    def selectAction(self, actions, game):
        #choose and return one of the actions in the list
        for action in actions:
            if action[0] >= 8 or action[0] == 4:
                return action
        for card in self.deck.hand:
            if isinstance(card, Action) and (not card.burned) and (card.metalUsed < card.capacity):
                if (5, card.metal) in actions:
                    return (5, card.metal)
        for action in actions:
            if action[0] == 3:
                return action
        for card in self.deck.hand:
            if isinstance(card, Action) and (not card.burned) and (card.metalUsed < card.capacity):
                for action in actions:
                    if action[0] == 2 and action[2] == card.metal and action[1] != card:
                        return action
        for action in actions:
            if action[0] == 2:
                return action
        for action in actions:
            if action[0] == 1:
                return action
        for action in actions:
            if action[0] == 6:
                return action
        return (0,)
    
    def senseCheckIn(self, card):
        #return a bool to use the sense ability
        return True

    def killEnemyAllyIn(self, allies):
        #return the index of the ally to kill or -1 to not kill any
        for i, ally in enumerate(allies):
            if ally in self.killOnSight:
                return i
        return 0
    
    def cloudAlly(self, card, ally):
        #return a bool to discard card to save ally 
        return True
    
    def eliminateIn(self):
        #return the index of the card to be eliminated or -1 to not eliminate. Indexing goes hand, discard
        h = len(self.deck.hand)
        d = len(self.deck.discard)
        return random.randint(0, h + d) - 1
    
    def pullIn(self):
        #return the index of the card to be pulled or -1 to not pull.
        return random.randint(0,len(self.deck.discard)) - 1
        
    
    def subdueIn(self, choices):
        #return the index of the card to gain. All are options are valid targets -1 to pick nothing
        return random.randint(0,len(choices)) - 1
    
    def soarIn(self, choices):
        #return the index of the eliminated card to buy or -1 to not
        return random.randint(0,len(choices)) - 1

    def confrontationIn(self, choices):
        #return the index of the card to use it's first ability or -1 to not
        return random.randint(0,len(choices)) - 1
    
    def informantIn(self, card):
        #return a bool to decide if card is removed from top of deck
        return True

    def keeperIn(self, choices):
        #return the index of the card in play to be set aside
        return random.randint(0,len(choices)) - 1
    
    def chooseIn(self, options):
        #each effect takes two indices. for the first effect return 0, and for the second return 2 etc.
        k = (len(options) // 2) - 1
        return random.randint(0, k)
    
    def refreshIn(self):
        #return the index of the metal to refresh
        for i, val in enumerate(self.metalTokens):
            if val in [2,4]:
                return i
        return random.randint(0,7)

    def pushIn(self):
        #return the index of the market card to push
        return random.randint(0, len(self.game.market.hand)) - 1
    
    def riotIn(self, riotable):
        #choose the ally from the list of valid allies to riot
        return random.choice(riotable)
    
    def seekIn(self, twice, seeker, choices):
        #im not going to try to explain this one... Henry I blame you for what's going on here
        choice = random.randint(-1, len(choices) - 1)
        if twice:
            choice2 = random.randint(-1, len(choices) - 2)
        else:
            choice2 = -1
        if choice == choice2 and choice > -1:
            choice2 += 1
        return choice, choice2
    
    def cloudP(self, card):
        #return a bool to decide if the card should be discarded to cloudp
        return True
    

class QualityBot(Player):
    def __init__(self, deck, game, turnOrder, name="B$", character='Kelsier'):
        super().__init__(deck, game, turnOrder, name, character)
        self.killOnSight = ['Hazekillers', 'Soldier', 'Pewterarm']
        with open("cardData.json", 'r') as f:
            self.cardData = json.load(f)

    def assignDamageIn(self, targets):
        #choose the index of the ally to kill by assigning damage to it or return -1 to go to player damage
        for i, target in enumerate(targets):
            if target.name in self.killOnSight:
                return i
        return -1

    def selectAction(self, actions, game):
        #choose and return one of the actions in the list
        for action in actions:
            if action[0] >= 8 or action[0] == 4:
                return action
        for card in self.deck.hand:
            if isinstance(card, Action) and (not card.burned) and (card.metalUsed < card.capacity):
                if (5, card.metal) in actions:
                    return (5, card.metal)
        for action in actions:
            if action[0] == 3:
                return action
        for card in self.deck.hand:
            if isinstance(card, Action) and (not card.burned) and (card.metalUsed < card.capacity):
                for action in actions:
                    if action[0] == 2 and action[2] == card.metal and action[1] != card:
                        return action
        for action in actions:
            if action[0] == 2:
                return action
        for action in actions:
            if action[0] == 1:
                return action
        bestVal = 0
        for action in actions:
            
            if action[0] == 6:
                if not (action[1].name in self.cardData):
                    return action
                elif self.cardData[action[1].name] > bestVal:
                    bestVal = self.cardData[action[1].name]
                    act = action
        if bestVal > 0.001:
            return act
        return (0,)
    
    def senseCheckIn(self, card):
        #return a bool to use the sense ability
        return True

    def killEnemyAllyIn(self, allies):
        #return the index of the ally to kill or -1 to not kill any
        for i, ally in enumerate(allies):
            if ally in self.killOnSight:
                return i
        return 0
    
    def cloudAlly(self, card, ally):
        #return a bool to discard card to save ally 
        return True
    
    def eliminateIn(self):
        #return the index of the card to be eliminated or -1 to not eliminate. Indexing goes hand, discard
        h = len(self.deck.hand)
        d = len(self.deck.discard)
        return random.randint(0, h + d) - 1
    
    def pullIn(self):
        #return the index of the card to be pulled or -1 to not pull.
        return random.randint(0,len(self.deck.discard)) - 1
        
    
    def subdueIn(self, choices):
        #return the index of the card to gain. All are options are valid targets -1 to pick nothing
        return random.randint(0,len(choices)) - 1
    
    def soarIn(self, choices):
        #return the index of the eliminated card to buy or -1 to not
        return random.randint(0,len(choices)) - 1

    def confrontationIn(self, choices):
        #return the index of the card to use it's first ability or -1 to not
        return random.randint(0,len(choices)) - 1
    
    def informantIn(self, card):
        #return a bool to decide if card is removed from top of deck
        return True

    def keeperIn(self, choices):
        #return the index of the card in play to be set aside
        return random.randint(0,len(choices)) - 1
    
    def chooseIn(self, options):
        #each effect takes two indices. for the first effect return 0, and for the second return 2 etc.
        k = (len(options) // 2) - 1
        return random.randint(0, k)
    
    def refreshIn(self):
        #return the index of the metal to refresh
        for i, val in enumerate(self.metalTokens):
            if val in [2,4]:
                return i
        return random.randint(0,7)

    def pushIn(self):
        #return the index of the market card to push
        return random.randint(0, len(self.game.market.hand)) - 1
    
    def riotIn(self, riotable):
        #choose the ally from the list of valid allies to riot
        return random.choice(riotable)
    
    def seekIn(self, twice, seeker, choices):
        #im not going to try to explain this one... Henry I blame you for what's going on here
        choice = random.randint(-1, len(choices) - 1)
        if twice:
            choice2 = random.randint(-1, len(choices) - 2)
        else:
            choice2 = -1
        if choice == choice2 and choice > -1:
            choice2 += 1
        return choice, choice2
    
    def cloudP(self, card):
        #return a bool to decide if the card should be discarded to cloudp
        return True
    

class FocusBot(Player):
    def __init__(self, deck, game, turnOrder, name="B$", character='Kelsier'):
        super().__init__(deck, game, turnOrder, name, character)
        self.killOnSight = ['Hazekillers', 'Soldier', 'Pewterarm']
        with open("cardData.json", 'r') as f:
            self.cardData = json.load(f)
        self.numCards = 20 
        self.totalValue = 0
        for card in self.deck.cards:
            self.totalValue += self.cardData[card.name]
        for card in self.deck.hand:
            self.totalValue += self.cardData[card.name]

    def assignDamageIn(self, targets):
        #choose the index of the ally to kill by assigning damage to it or return -1 to go to player damage
        for i, target in enumerate(targets):
            if target.name in self.killOnSight:
                return i
        return -1

    def selectAction(self, actions, game):
        #choose and return one of the actions in the list
        for action in actions:
            if action[0] >= 8 or action[0] == 4:
                return action
        for card in self.deck.hand:
            if isinstance(card, Action) and (not card.burned) and (card.metalUsed < card.capacity):
                if (5, card.metal) in actions:
                    return (5, card.metal)
        for action in actions:
            if action[0] == 3:
                return action
        for card in self.deck.hand:
            if isinstance(card, Action) and (not card.burned) and (card.metalUsed < card.capacity):
                for action in actions:
                    if action[0] == 2 and action[2] == card.metal and action[1] != card:
                        return action
        for action in actions:
            if action[0] == 2:
                return action
        for action in actions:
            if action[0] == 1:
                return action
        bestVal = 0
        for action in actions:
            
            if action[0] == 6:
                if not (action[1].name in self.cardData):
                    return action
                elif self.cardData[action[1].name] > bestVal:
                    bestVal = self.cardData[action[1].name]
                    act = action
        if bestVal > (self.totalValue / self.numCards):
            self.totalValue += bestVal
            self.numCards += 1
            return act
        bestVal = 0
        for action in actions:          
            if action[0] == 7 and self.cardData[action[1].name] > bestVal:
                bestVal = self.cardData[action[1].name]
                act = action
        if bestVal > 0.001:
            return act
        return (0,)
    
    def senseCheckIn(self, card):
        #return a bool to use the sense ability
        return True

    def killEnemyAllyIn(self, allies):
        #return the index of the ally to kill or -1 to not kill any
        for i, ally in enumerate(allies):
            if ally in self.killOnSight:
                return i
        return 0
    
    def cloudAlly(self, card, ally):
        #return a bool to discard card to save ally 
        return True
    
    def eliminateIn(self):
        #return the index of the card to be eliminated or -1 to not eliminate. Indexing goes hand, discard
        minval = 2
        ind = -1
        for i, card in enumerate(self.deck.hand):
            if self.cardData[card.name] < minval:
                minval = self.cardData[card.name]
                ind = i
        for i, card in enumerate(self.deck.discard):
            if self.cardData[card.name] < minval:
                minval = self.cardData[card.name]
                ind = i + len(self.deck.hand)
        if minval > (self.totalValue / self.numCards):
            ind = -1
        else:
            self.totalValue -= minval
            self.numCards -= 1
        return ind
    
    def pullIn(self):
        #return the index of the card to be pulled or -1 to not pull.
        maxVal = self.totalValue / self.numCards
        ind = -1
        for i, card in enumerate(self.deck.discard):
            if self.cardData[card.name] > maxVal:
                maxVal = self.cardData[card.name]
                ind = i
        return ind
        
    
    def subdueIn(self, choices):
        #return the index of the card to gain. All are options are valid targets -1 to pick nothing
        bestVal = self.totalValue / self.numCards
        ind = -1
        for i, choice in enumerate(choices):
            if self.cardData[choice.name] > bestVal:
                bestVal = self.cardData[choice.name]
                ind = i
        if ind > -1:
            self.totalValue += bestVal
            self.numCards += 1
        return ind
    
    def soarIn(self, choices):
        #return the index of the eliminated card to buy or -1 to not
        bestVal = self.totalValue / self.numCards
        ind = -1
        for i, choice in enumerate(choices):
            if self.cardData[choice.name] > bestVal:
                bestVal = self.cardData[choice.name]
                ind = i
        if ind > -1:
            self.totalValue += bestVal
            self.numCards += 1
        return ind

    def confrontationIn(self, choices):
        #return the index of the card to use it's first ability or -1 to not
        bestVal = 0
        ind = -1
        for i, choice in enumerate(choices):
            if self.cardData[choice.name] > bestVal and choice.name != "Confrontation":
                bestVal = self.cardData[choice.name]
                ind = i
        return ind
    
    def informantIn(self, card):
        #return a bool to decide if card is removed from top of deck
        if(self.cardData[card.name] < self.totalValue / self.numCards):
            self.totalValue -= self.cardData[card.name]
            self.numCards -= 1
            return True
        return False


    def keeperIn(self, choices):
        #return the index of the card in play to be set aside
        bestVal = 0
        ind = -1
        for i, choice in enumerate(choices):
            if self.cardData[choice.name] > bestVal:
                bestVal = self.cardData[choice.name]
                ind = i
        return ind
    
    def chooseIn(self, options):
        #each effect takes two indices. for the first effect return 0, and for the second return 2 etc.
        k = (len(options) // 2) - 1
        return random.randint(0, k)
    
    def refreshIn(self):
        #return the index of the metal to refresh
        for i, val in enumerate(self.metalTokens):
            if val in [2,4]:
                return i
        return random.randint(0,7)

    def pushIn(self):
        #return the index of the market card to push
        return random.randint(0, len(self.game.market.hand)) - 1
    
    def riotIn(self, riotable):
        #choose the ally from the list of valid allies to riot
        return random.choice(riotable)
    
    def seekIn(self, twice, seeker, choices):
        #im not going to try to explain this one... Henry I blame you for what's going on here
        bestVal = 0
        choice = -1
        for i, c in enumerate(choices):
            if self.cardData[c.name] > bestVal:
                bestVal = self.cardData[c.name]
                choice = i
        choice = random.randint(-1, len(choices) - 1)
        if twice:
            choice2 = random.randint(-1, len(choices) - 2)
        else:
            choice2 = -1
        if choice == choice2 and choice > -1:
            choice2 += 1
        return choice, choice2
    
    def cloudP(self, card):
        #return a bool to decide if the card should be discarded to cloudp
        return True
    

