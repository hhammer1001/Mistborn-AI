import csv
from card import Card, Funding, Ally, Action
from player import Player
import random
import numpy as np
import json
from typing import List

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
        if len(actions) == 1:
            return actions[0]
        else:
            return random.choice(actions[1:])
    
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
    def __init__(self, deck, game, turnOrder, name="B$", character='Kelsier', analysisMode=False):
        super().__init__(deck, game, turnOrder, name, character, analysisMode)
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
            if (action[0] >= 8 and action[0] <= 11) or action[0] == 4:
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
    
class HammerBot(Player):
    
    def __init__(self, deck, game, turnOrder, name="B$", character='Kelsier', analysisMode=False):
        super().__init__(deck, game, turnOrder, name, character, analysisMode)
    
    def get_starters(self):
        starter_names = []
        with open('starterdecks.csv', newline='') as csvfile:
            lines = csv.reader(csvfile, delimiter=',', quotechar='|')
            for row in lines:
                starter_names += [row[2]]
        return starter_names
    
    def get_damage(self, card):
        #HammerBot sorts by highest damage
        if isinstance(card, Ally):
            return 0
        elif isinstance(card, Funding):
            return 0
        elif isinstance(card, Action):
            abils = [(card.data[3], card.data[4]), (card.data[5], card.data[6]), (card.data[7], card.data[8])]
            abils = [(i[0].split('.'), i[1].split('.')) for i in abils if i != '']
            for abil in abils:
                if 'D' in abil[0]:
                    return int(abil[1][abil[0].index('D')])
        return 0
        
    def assignDamageIn(self, targets):
        #choose the index of the ally to kill by assigning damage to it or return -1 to go to player damage
        return -1  # HammerBot does not assign damage to allies, always goes to player damage

    def selectAction(self, actions, game):
        #choose and return one of the actions in the list
        # if len(actions) == 1:
        #     return actions[0]
        # else:
        #     return random.choice(actions[1:])
        missions = sorted([action[1] for action in actions if action[0] == 1], key=lambda x: len(x.name))
        if len(missions) > 0:
            for mission in missions:
                if mission.name == "Luthadel Garrison":
                    return (1, mission)
            return (1, missions[0])
        
        allyPlayerAbilities = [action for action in actions if (action[0] in [8, 9, 10, 11])]
        if allyPlayerAbilities:
            return allyPlayerAbilities[0]
        
        if len(self.deck.hand) > 0 and set([c.data[0] for c in self.deck.hand]) != set(['Funding']):
            hand_damage = sorted(self.deck.hand, key=lambda x: -1*self.get_damage(x))
            for c in hand_damage:
                if (4, c) in actions:
                    return (4, c)
                if (self.metalTokens[:-1].count(1) + self.metalTokens[-1]) < self.burns and isinstance(c, Action) and (5, c.metal) in actions:
                    return (5, c.metal)
            for i, c in enumerate(hand_damage):
                for c2 in hand_damage[i+1:]:
                    if (2, c2, c.metal) in actions:
                        return (2, c2, c.metal)
            if (5, 8) in actions and (self.charAbility3 and self.training >= 13):
                return (5, 8)
                
        buys = sorted([action[1] for action in actions if action[0] == 6], key=lambda x: -1*self.get_damage(x))
        if len(buys) > 0:
            return (6, buys[0])
        
        metal_prio = [(c, c.metal) for c in self.allies if (c.available2 and self.metalBurned[c.metal] > 1)] + [(c, c.metal) for c in self.allies if c.available1]
        for c, m in metal_prio:
            if (5, m) in actions:
                return (5, m)
            for c2 in self.deck.hand:
                if (2, c2, m) in actions:
                    return (2, c2, m)
        selfMetal = int(self.ability1metal)
        if (self.charAbility1 and self.training >= 5):
            if (5, selfMetal) in actions:
                return (5, selfMetal)
            for c in self.deck.hand:
                if (2, c, selfMetal) in actions:
                    return (2, c, selfMetal)

        if (self.charAbility3 and self.training >= 13):
            for c, m in metal_prio:
                if (12, m) in actions:
                    return (12, m)
                
        for action in actions:
            if action[0] == 3:
                return action
            
        return (0,)

    
    def senseCheckIn(self, card):
        #return a bool to use the sense ability
        return 0

    def killEnemyAllyIn(self, allies):
        #return the index of the ally to kill or -1 to not kill any
        if len(allies) == 0:
            return -1
        # HammerBot always kills the ally with the highest health
        ally_healths = [(i, target.health) for i, target in enumerate(allies)]
        ally_healths.sort(key=lambda x: x[1])
        return ally_healths[-1][0]
    
    def cloudAlly(self, card, ally):
        #return a bool to discard card to save ally 
        return 0
    
    def eliminateIn(self):
        #return the index of the card to be eliminated or -1 to not eliminate. Indexing goes hand, discard
        h = len(self.deck.hand)
        d = len(self.deck.discard)
        for c in self.deck.hand:
            if isinstance(c, Funding):
                return self.deck.hand.index(c)
        for c in self.deck.discard:
            if isinstance(c, Funding):
                return self.deck.discard.index(c) + h
        return random.randint(0, h + d) - 1
    
    def pullIn(self):
        #return the index of the card to be pulled or -1 to not pull.
        damage_vals = [(i, self.get_damage(c)) for i, c in enumerate(self.deck.discard) if self.get_damage(c) > 0]
        damage_vals.sort(key=lambda x: x[1])
        if len(damage_vals) > 0:
            return damage_vals[-1][0]
        return -1
    
    def subdueIn(self, choices):
        #return the index of the card to gain. All are options are valid targets -1 to pick nothing
        damage_vals = [(i, self.get_damage(c)) for i, c in enumerate(choices) if self.get_damage(c) > 0]
        damage_vals.sort(key=lambda x: x[1])
        if len(damage_vals) > 0:
            return damage_vals[-1][0]
        return -1
    
    def soarIn(self, choices):
        #return the index of the eliminated card to buy or -1 to not
        damage_vals = [(i, self.get_damage(c)) for i, c in enumerate(choices) if self.get_damage(c) > 0]
        damage_vals.sort(key=lambda x: x[1])
        if len(damage_vals) > 0:
            return damage_vals[-1][0]
        return -1

    def confrontationIn(self, choices):
        #return the index of the card to use it's first ability or -1 to not
        damage_vals = [(i, self.get_damage(c)) for i, c in enumerate(choices) if self.get_damage(c) > 0]
        damage_vals.sort(key=lambda x: x[1])
        if len(damage_vals) > 0:
            return damage_vals[-1][0]
        return -1
    
    def informantIn(self, card):
        #return a bool to decide if card is removed from top of deck
        d = self.get_damage(card)
        if d > 0:
            return 0
        else:
            return 1
        
    def keeperIn(self, choices):
        #return the index of the card in play to be set aside
        return random.randint(0,len(choices)) - 1
    
    def chooseIn(self, options):
        #each effect takes two indices. for the first effect return 0, and for the second return 2 etc.
        k = (len(options) // 2) - 1
        return random.randint(0, k)
    
    def refreshIn(self):
        #return the index of the metal to refresh
        return random.randint(6,7)

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
        return 0
        
class Twonky(Player):
    def __init__(self, deck, game, turnOrder, name='Twonky', character='Marsh', analysisMode=False):
        super().__init__(deck, game, turnOrder, name, character, analysisMode)
        self.buffer = 0
        self.unlearnt = True #TODO
        self.synergy=False
        # if self.synergy:
        #     with open("syns0.json", 'r') as f:
        #         self.twonkySynDict = json.load(f)
        with open("wins2.json", 'r') as f:
            self.twonkyCardDict = json.load(f)
        self.seekCount = 0
        self.costMult = 0
        self.scoreMult = 1 #testing
        self.cardDataFile = "twonkyCardData.json"
        self.missionDataFile = "twonkyMissionData.json"
        with open(self.cardDataFile, 'r') as f:
            self.cardData = json.load(f)
        for name in self.cardData:
            if self.unlearnt:
                self.cardData[name] = 0.5 + (random.random()/100)
            else:
                self.cardData[name] += self.twonkyCardDict[name][2]
        self.cardData["Funding"] = 0
        with open(self.missionDataFile, 'r') as f:
            self.missionLookup = json.load(f)
        # self.missionOrder = {0:"", 1:"", 2:""}
        # self.missionsFinished = 0
    # {
    #     "Canton Of Orthodoxy":0.9,
    #     "Luthadel Garrison":0.1,
    #     "Keep Venture":0.85,
    #     "Skaa Caverns":0.5,
    #     "Pits Of Hathsin":0.6,
    #     "Kredik Shaw":0.95,
    #     "Crew Hideout":0.3, 
    #     "Luthadel Rooftops":0.65
    # }
    
    def card_lookup(self, card: Card) -> int:
        try:
            return self.cardData[card.name]
        except KeyError:
            print(f"{card.name} not in {self.cardDataFile}") 
    
    def sorting_algo(self, card: Card):
        #Twonky sorts by card rating
        return self.card_lookup(card)*self.scoreMult + card.cost*self.costMult

    def assignDamageIn(self, targets: List[Card]) -> int:
        #choose the index of the ally to kill by assigning damage to it or return -1 to go to player damage
        options = sorted([(i, targets[i], self.card_lookup(targets[i])) for i in range(len(targets))], key=lambda x: -x[2])
        for ind, target, score in options:
            if score > self.buffer:
                return ind
        return -1
                

    def selectAction(self, actions, game):
        #choose and return one of the actions in the list
        # if len(actions) == 1:
        #     return actions[0]
        # else:
        #     return random.choice(actions[1:])
        """
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
        case 12:
            print(f"{i}: use an atium token to for {game.metalCodes[action[2]]}")
        case 13:
            print(f"{i}: buy {action[1]} using all money and {action[2]} boxings")
        case 14:
            print(f"{i}: buy {action[1]} using all money and {action[2]} boxings and then eliminate it using it's first ability") 
        """        
        #Mission Actions (1)
        missions = sorted([action[1] for action in actions if action[0] == 1], key=lambda x: self.missionLookup[x.name])
        if len(missions) > 0:
            # if missions[0].playerRanks[self.turnOrder] == 11:
            #     self.missionOrder[self.missionsFinished] = missions[0].name
            #     self.missionsFinished += 1
            return (1, missions[0])
        #Ally and Player Actions (8-11)
        allyPlayerAbilities = [action for action in actions if (action[0] in [8, 9, 10, 11])]
        if allyPlayerAbilities:
            return allyPlayerAbilities[0]
        
        handScores = sorted([(card, self.sorting_algo(card)) for card in self.deck.hand], key=lambda x:x[1], reverse=True) #testing
        # print(handScores, actions)
        for card, score in handScores:
            if isinstance(card, Action) and (not card.burned) and card.metalUsed < card.capacity:
                if (4, card) in actions:
                    return (4, card)
                if (3, card, card.metal) in actions:
                    refreshes = sorted([action for action in actions if action[0] == 3], key=lambda x: self.sorting_algo(x[1]))
                    return refreshes[0]
                if (self.metalTokens[:-1].count(1) + self.metalTokens[-1]) < self.burns and (5, card.metal) in actions:
                    return (5, card.metal)
                if game.turncount < 6:
                    return (5, card.metal)
                cur, burning = handScores.index((card, score)), len(handScores) - 1
                while cur < burning:
                    if (2, handScores[burning][0], card.metal) in actions:
                        return (2, handScores[burning][0], card.metal)
                    burning -= 1
                if (12, card.metal) in actions:
                    return (12, card.metal)

        
        extraneousBurns = [action for action in actions if action[0] == 2]
        if extraneousBurns:
            return extraneousBurns[0]
        
        metal_prio = [(c, c.metal) for c in self.allies if (c.available2 and self.metalBurned[c.metal] > 1)] + [(c, c.metal) for c in self.allies if c.available1]
        for c, m in metal_prio:
            if (5, m) in actions:
                return (5, m)
            for c2 in self.deck.hand:
                if (2, c2, m) in actions:
                    return (2, c2, m)
        selfMetal = int(self.ability1metal)
        if (self.charAbility1 and self.training >= 5):
            if (5, selfMetal) in actions:
                return (5, selfMetal)
            for c in self.deck.hand:
                if (2, c, selfMetal) in actions:
                    return (2, c, selfMetal)

        if (self.charAbility3 and self.training >= 13):
            for c, m in metal_prio:
                if (12, m) in actions:
                    return (12, m)
                
        for action in actions:
            if action[0] == 3:
                return action

        # print(self.deck.hand)
        # print(self.curMoney, game.market.hand)
        boxingBuys = sorted([action for action in actions if (action[0] == 13 and action[1].cost > 5 and not isinstance(action[1], Ally))], key=lambda x: -1*self.sorting_algo(x[1]))
        buys = sorted([action for action in actions if action[0] == 6], key=lambda x: -1*self.sorting_algo(x[1]))
        if game.turncount < 1000:
            buys = [action for action in buys if self.sorting_algo(action[1]) >= self.buffer]
        if len(boxingBuys) > 0:
            # print([(card, self.sorting_algo(card)) for card in game.market.hand], boxingBuys[0], boxingBuys)
            return boxingBuys[0]
        if len(buys) > 0 and (self.curMoney > 2 or [card for card in self.game.market.hand if card.cost > 6 and not isinstance(card, Ally)]):
            # print([(card, self.sorting_algo(card)) for card in game.market.hand], buys[0], buys)
            return buys[0]
        
        self.seekCount = 0
        return (0,)

    
    def senseCheckIn(self, card):
        #return a bool to use the sense ability
        return True

    def killEnemyAllyIn(self, allies):
        #return the index of the ally to kill or -1 to not kill any
        if len(allies) == 0:
            return -1
        # HammerBot always kills the ally with the highest health
        ally_healths = [(i, target.health) for i, target in enumerate(allies)]
        ally_healths.sort(key=lambda x: x[1])
        return ally_healths[-1][0]
    
    def cloudAlly(self, card, ally):
        #return a bool to discard card to save ally 
        return False
    
    def eliminateIn(self):
        #return the index of the card to be eliminated or -1 to not eliminate. Indexing goes hand, discard
        h = len(self.deck.hand)
        d = len(self.deck.discard)
        if d+h < 5:
            return -1
        for c in self.deck.hand:
            if isinstance(c, Funding):
                return self.deck.hand.index(c)
        for c in self.deck.discard:
            if isinstance(c, Funding):
                return self.deck.discard.index(c) + h
        cards = [(thing[0], thing[1], self.sorting_algo(thing[1])) for thing in enumerate(self.deck.hand + self.deck.discard)]
        elimThrouple = min(cards, key=lambda x:x[2])
        # print(f"eliminating f{elimThrouple[1].name}")
        # if elimThrouple[2] < 1.25: #TODO magic number
        #     return elimThrouple[0]
        # else:
        #     return -1
        return elimThrouple[0]
        
    
    def pullIn(self):
        #return the index of the card to be pulled or -1 to not pull.
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(self.deck.discard) if self.sorting_algo(c) > 0]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1
    
    def subdueIn(self, choices):
        #return the index of the card to gain. All are options are valid targets -1 to pick nothing
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices) if self.sorting_algo(c) > 0]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1
    
    def soarIn(self, choices):
        #return the index of the eliminated card to buy or -1 to not
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices) if self.sorting_algo(c) > 0]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1

    def confrontationIn(self, choices):
        #return the index of the card to use it's first ability or -1 to not
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices) if self.sorting_algo(c) > 0]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1
    
    def informantIn(self, card):
        #return a bool to decide if card is removed from top of deck
        d = self.sorting_algo(card)
        if d > self.buffer:
            return 0
        else:
            return 1
        
    def keeperIn(self, choices):
        #return the index of the card in play to be set aside
        return -1
    
    def chooseIn(self, options):
        #each effect takes two indices. for the first effect return 0, and for the second return 2 etc.
        if 'Mi' in options:
            return options.index('Mi')//2
        elif 'T' in options:
            return options.index('T')//2
        elif 'M' in options:
            return options.index('M')//2
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
        choices = self.game.market.hand
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices) if self.sorting_algo(c) > 0]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1
    
    def riotIn(self, riotable):
        #choose the ally from the list of valid allies to riot
        choices = riotable
        sortedChoices = [(c, self.sorting_algo(c)) for i, c in enumerate(choices)]
        sortedChoices.sort(key=lambda x: x[1])
        return sortedChoices[-1][0]

    
    def seekIn(self, twice, seeker, choices):
        #im not going to try to explain this one... Henry I blame you for what's going on here
        self.seekCount += 1
        if self.seekCount > 100:
            return -1, -1
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices)]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) == 1 or not twice:
            return sortedChoices[-1][0], -1
        elif len(sortedChoices):
            return sortedChoices[-1][0], sortedChoices[-2][0]
        return -1, -1
    
    def cloudP(self, card):
        #return a bool to decide if the card should be discarded to cloudp
        if card.name == "Coppercloud":
            return True
        else:
            return False

class CharacterTwonky(Player):
    def __init__(self, deck, game, turnOrder, name='CharacterTwonky', character='Marsh', analysisMode=False, specialInput=[]):
        super().__init__(deck, game, turnOrder, name, character, analysisMode)
        # self.synergy=True
        # if self.synergy:
        #     with open("syns2.json", 'r') as f:
        #         self.twonkySynDict = json.load(f)
        # with open("wins2.json", 'r') as f:
        #     self.twonkyCardDict = json.load(f)
        self.seekCount = 0
        self.unlearnt = False
        # charData = {"Kelsier": 0.085, "Marsh": 0.25, "Shan": -0.16, "Vin": 0.1, "Prodigy": -0.13} #trained
        # charData = {"Kelsier": 0, "Marsh": 0.195, "Shan": -0.18, "Vin": 0.03, "Prodigy": -0.2} #human guessed
        if self.character in specialInput[0]: #['Kelsier', 'Vin', 'Shan', 'Prodigy', 'Shan']:
            # self.buffer = charData[self.character]
            self.buffer = specialInput[1]
            with open(f"{self.character}3.json", 'r') as f:
                self.cardData = json.load(f)
        else:
            self.buffer = 0
            with open("wins2.json", 'r') as f:
                self.cardData = json.load(f)
        for card in self.cardData:
            if self.unlearnt:
                self.cardData[card] = 0.5 + (random.random()/100)
            else:
                self.cardData[card] = self.cardData[card][2]
        self.missionDataFile = "twonkyMissionData.json"
        with open(self.missionDataFile, 'r') as f:
            self.missionLookup = json.load(f)
    
    def card_lookup(self, card: Card) -> int:
        try:
            return self.cardData[card.name]
        except KeyError:
            print(f"{card.name} not in {self.cardDataFile}") 
    
    def synergy_rating(self, card1: Card, card2: Card):
        nameOrder = sorted([card1.name, card2.name])
        dictKey = nameOrder[0] + "-" + nameOrder[1]
        return self.twonkySynDict[dictKey][2]

    def sorting_algo(self, card: Card):
        #Twonky sorts by card rating
        
        # allCards = self.deck.hand + self.deck.discard + self.deck.cards
        # synScore = 0
        # for otherCard in allCards:
        #     if not isinstance(otherCard, Funding) and card.name != otherCard.name:
        #         synScore += self.synergy_rating(otherCard, card)
        # # normScore = self.card_lookup(card)*self.scoreMult + card.cost*self.costMult
        # normScore = self.card_lookup(card)
        # if isinstance(card, Funding):
        #     normScore = -1
        # # print(card.name, synScore, normScore, normScore + synScore)
        # return normScore / 5 + synScore
        return self.card_lookup(card)

    def assignDamageIn(self, targets: List[Card]) -> int:
        #choose the index of the ally to kill by assigning damage to it or return -1 to go to player damage
        options = sorted([(i, targets[i], self.card_lookup(targets[i])) for i in range(len(targets))], key=lambda x: -x[2])
        for ind, target, score in options:
            if score > 0.5:
                return ind
        return -1


    def selectAction(self, actions, game):
        #choose and return one of the actions in the list
        # if len(actions) == 1:
        #     return actions[0]
        # else:
        #     return random.choice(actions[1:])
        """
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
        case 12:
            print(f"{i}: use an atium token to for {game.metalCodes[action[2]]}")
        case 13:
            print(f"{i}: buy {action[1]} using all money and {action[2]} boxings")
        case 14:
            print(f"{i}: buy {action[1]} using all money and {action[2]} boxings and then eliminate it using it's first ability") 
        """        

        #Mission Actions (1)
        missions = sorted([action[1] for action in actions if action[0] == 1], key=lambda x: self.missionLookup[x.name])
        if len(missions) > 0:
            # if missions[0].playerRanks[self.turnOrder] == 11:
            #     self.missionOrder[self.missionsFinished] = missions[0].name
            #     self.missionsFinished += 1
            return (1, missions[0])
        #Ally and Player Actions (8-11)
        allyPlayerAbilities = [action for action in actions if (action[0] in [8, 9, 10, 11])]
        if allyPlayerAbilities:
            return allyPlayerAbilities[0]
        """
        ideas for burning metals, playing cards, etc
        
        possible priorities:
        playing most cards possible, highest rating to lowest rating
        playing most cards possible, highest cost to lowest cost
        playing most abilities on each card, highest rating to lowest rating
        playing most abilities on each card, highest cost to lowest cost
        """
        
        handScores = sorted([(card, self.sorting_algo(card)) for card in self.deck.hand], key=lambda x:x[1], reverse=True) #testing
        # print(handScores, actions)
        for card, score in handScores:
            if isinstance(card, Action) and (not card.burned) and card.metalUsed < card.capacity:
                if (4, card) in actions:
                    # print(f"did {(4, card)}")
                    return (4, card)
                if (3, card, card.metal) in actions:
                    refreshes = sorted([action for action in actions if action[0] == 3], key=lambda x: self.sorting_algo(x[1]))
                    # print(refreshes[0])
                    return refreshes[0]
                if (self.metalTokens[:-1].count(1) + self.metalTokens[-1]) < self.burns and (5, card.metal) in actions:
                    # print(f"burned {(5, card.metal)} for {card}")
                    return (5, card.metal)
                if game.turncount < 6:
                    # print(f"flared {(5, card.metal)} for {card}")
                    return (5, card.metal)
                cur, burning = handScores.index((card, score)), len(handScores) - 1
                while cur < burning:
                    if (2, handScores[burning][0], card.metal) in actions:
                        return (2, handScores[burning][0], card.metal)
                    burning -= 1
                if (12, card.metal) in actions:
                    return (12, card.metal)
                # if (5, 8) in actions and (self.charAbility3 and self.training >= 13):  #testing
                #     return (5, 8)
        
        extraneousBurns = [action for action in actions if action[0] == 2]
        if extraneousBurns:
            return extraneousBurns[0]
        
        metal_prio = [(c, c.metal) for c in self.allies if (c.available2 and self.metalBurned[c.metal] > 1)] + [(c, c.metal) for c in self.allies if c.available1]
        for c, m in metal_prio:
            if (5, m) in actions:
                return (5, m)
            for c2 in self.deck.hand:
                if (2, c2, m) in actions:
                    return (2, c2, m)
        selfMetal = int(self.ability1metal)
        if (self.charAbility1 and self.training >= 5):
            if (5, selfMetal) in actions:
                return (5, selfMetal)
            for c in self.deck.hand:
                if (2, c, selfMetal) in actions:
                    return (2, c, selfMetal)

        if (self.charAbility3 and self.training >= 13):
            for c, m in metal_prio:
                if (12, m) in actions:
                    return (12, m)
                
        for action in actions:
            if action[0] == 3:
                return action

        # print(self.deck.hand)
        # print(self.curMoney, game.market.hand)
        boxingBuys = sorted([action for action in actions if (action[0] == 13 and action[1].cost > 5 and not isinstance(action[1], Ally))], key=lambda x: -1*self.sorting_algo(x[1]))
        buys = sorted([action for action in actions if action[0] == 6 and self.sorting_algo(action[1]) >= self.buffer], key=lambda x: -1*self.sorting_algo(x[1]))
        if len(boxingBuys) > 0:
            # print([(card, self.sorting_algo(card)) for card in game.market.hand], boxingBuys[0], boxingBuys)
            return boxingBuys[0]
        if len(buys) > 0 and (self.curMoney > 2 or [card for card in self.game.market.hand if card.cost > 6 and not isinstance(card, Ally)]):
            # print([(card, self.sorting_algo(card)) for card in game.market.hand], buys[0], buys)
            return buys[0]
        
        self.seekCount = 0
        return (0,)

    
    def senseCheckIn(self, card):
        #return a bool to use the sense ability
        return True

    def killEnemyAllyIn(self, allies):
        #return the index of the ally to kill or -1 to not kill any
        if len(allies) == 0:
            return -1
        # HammerBot always kills the ally with the highest health
        ally_healths = [(i, target.health) for i, target in enumerate(allies)]
        ally_healths.sort(key=lambda x: x[1])
        return ally_healths[-1][0]
    
    def cloudAlly(self, card, ally):
        #return a bool to discard card to save ally 
        return False
    
    def eliminateIn(self):
        #return the index of the card to be eliminated or -1 to not eliminate. Indexing goes hand, discard
        h = len(self.deck.hand)
        d = len(self.deck.discard)
        c = len(self.deck.cards)
        if d+h+c < 6:
            return -1
        for c in self.deck.hand:
            if isinstance(c, Funding):
                return self.deck.hand.index(c)
        for c in self.deck.discard:
            if isinstance(c, Funding):
                return self.deck.discard.index(c) + h
        cards = [(thing[0], thing[1], self.sorting_algo(thing[1])) for thing in enumerate(self.deck.hand + self.deck.discard) if self.sorting_algo(thing[1]) < self.buffer]
        if not cards:
            return -1
        else:
            elimThrouple = min(cards, key=lambda x:x[2])
            return elimThrouple[0]
        
    
    def pullIn(self):
        #return the index of the card to be pulled or -1 to not pull.
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(self.deck.discard) if self.sorting_algo(c) > self.buffer]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1
    
    def subdueIn(self, choices):
        #return the index of the card to gain. All are options are valid targets -1 to pick nothing
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices) if self.sorting_algo(c) > self.buffer]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1
    
    def soarIn(self, choices):
        #return the index of the eliminated card to buy or -1 to not
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices) if self.sorting_algo(c) > self.buffer]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1

    def confrontationIn(self, choices):
        #return the index of the card to use it's first ability or -1 to not
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices) if self.sorting_algo(c) > self.buffer]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1
    
    def informantIn(self, card):
        #return a bool to decide if card is removed from top of deck
        d = self.sorting_algo(card)
        if d > 0.5:
            return 0
        else:
            return 1
        
    def keeperIn(self, choices):
        #return the index of the card in play to be set aside
        return -1
    
    def chooseIn(self, options):
        #each effect takes two indices. for the first effect return 0, and for the second return 2 etc.
        if 'Mi' in options:
            return options.index('Mi')//2
        elif 'T' in options:
            return options.index('T')//2
        elif 'M' in options:
            return options.index('M')//2
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
        choices = self.game.market.hand
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices) if self.sorting_algo(c) > self.buffer]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1
    
    def riotIn(self, riotable):
        #choose the ally from the list of valid allies to riot
        choices = riotable
        sortedChoices = [(c, self.sorting_algo(c)) for i, c in enumerate(choices)]
        sortedChoices.sort(key=lambda x: x[1])
        return sortedChoices[-1][0]

    
    def seekIn(self, twice, seeker, choices):
        #im not going to try to explain this one... Henry I blame you for what's going on here
        self.seekCount += 1
        if self.seekCount > 100:
            return -1, -1
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices)]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) == 1 or not twice:
            return sortedChoices[-1][0], -1
        elif len(sortedChoices):
            return sortedChoices[-1][0], sortedChoices[-2][0]
        return -1, -1
    
    def cloudP(self, card):
        #return a bool to decide if the card should be discarded to cloudp
        if card.name == "Coppercloud":
            return True
        else:
            return False
        
class EmployedTwonky(Player):
    def __init__(self, deck, game, turnOrder, name='EmployedTwonky', character='Marsh', analysisMode=False, specialInput=[]):
        self.job = ''
        self.buffer = 0.5
        self.unlearnt = False
        super().__init__(deck, game, turnOrder, name, character, analysisMode)
        with open("wins2.json", 'r') as f:
            self.cardData = json.load(f)
        with open("categor2.json", 'r') as f:
            self.categoryData = json.load(f)
        for card in self.cardData:
            if self.unlearnt:
                self.cardData[card] = 0.5 + (random.random()/100)
            else:
                self.cardData[card] = self.cardData[card][2] + 0.5
            # self.cardData[card] = self.categoryData['M'][card][2]
        self.seekCount = 0
        # self.costMult = 0.6 #testing
        # self.scoreMult = 0.8 #testing
        self.missionDataFile = "twonkyMissionData.json"
        with open(self.missionDataFile, 'r') as f:
            self.missionLookup = json.load(f)
        # self.missionOrder = {0:"", 1:"", 2:""}
        # self.missionsFinished = 0
    # {
    #     "Canton Of Orthodoxy":0.9,
    #     "Luthadel Garrison":0.1,
    #     "Keep Venture":0.85,
    #     "Skaa Caverns":0.5,
    #     "Pits Of Hathsin":0.6,
    #     "Kredik Shaw":0.95,
    #     "Crew Hideout":0.3, 
    #     "Luthadel Rooftops":0.65
    # }
    
    def card_lookup(self, card: Card) -> int:
        try:
            return self.cardData[card.name]
        except KeyError:
            print(f"{card.name} not in {self.cardDataFile}") 
    
    def sorting_algo(self, card: Card):
        #Twonky sorts by card rating
        return self.card_lookup(card)

    def assignDamageIn(self, targets: List[Card]) -> int:
        #choose the index of the ally to kill by assigning damage to it or return -1 to go to player damage
        options = sorted([(i, targets[i], self.card_lookup(targets[i])) for i in range(len(targets))], key=lambda x: -x[2])
        for ind, target, score in options:
            if score > self.buffer:
                return ind
        return -1


    def selectAction(self, actions, game):
        #choose and return one of the actions in the list
        # if len(actions) == 1:
        #     return actions[0]
        # else:
        #     return random.choice(actions[1:])
        """
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
        case 12:
            print(f"{i}: use an atium token to for {game.metalCodes[action[2]]}")
        case 13:
            print(f"{i}: buy {action[1]} using all money and {action[2]} boxings")
        case 14:
            print(f"{i}: buy {action[1]} using all money and {action[2]} boxings and then eliminate it using it's first ability") 
        """        

        #job selection

        if not self.job and game.turncount > 10:
            badCards = ['Pewter Training',
                        'Tin Training',
                        'Bronze Training',
                        'Copper Training',
                        'Zinc Training',
                        'Brass Training',
                        'Iron Training',
                        'Steel Training',
                        'Funding']
            allCards = list(self.cardData.keys())
            mCards = {x[1]:x[0] for x in enumerate(sorted(allCards, key=lambda x: -self.categoryData['M'][x][2]))}
            dCards = {x[1]:x[0] for x in enumerate(sorted(allCards, key=lambda x: -self.categoryData['D'][x][2]))}
            cCards = {x[1]:x[0] for x in enumerate(sorted(allCards, key=lambda x: -self.categoryData['C'][x][2]))}
            # mScore, dScore, cScore = mCards['Funding'], dCards['Funding'], cCards['Funding']
            mScore, dScore, cScore = 0, 0, 0
            cards = [card for card in self.deck.hand + self.deck.discard + self.deck.cards if card.name not in badCards]
            for card in cards:
                mScore += mCards[card.name]
                dScore += dCards[card.name]
                cScore += cCards[card.name]
            # print([(card, mCards[card.name], dCards[card.name], cCards[card.name]) for card in cards], mScore, dScore, cScore)
            if min([mScore, dScore]) == mScore:
                # self.buffer = 0.54
                self.job = 'M'
            elif min([mScore, dScore]) == dScore:
                self.job = 'D'
                # self.buffer = -0.54

        #Mission Actions (1)
        missions = sorted([action[1] for action in actions if action[0] == 1], key=lambda x: self.missionLookup[x.name])
        if len(missions) > 0:
            # if missions[0].playerRanks[self.turnOrder] == 11:
            #     self.missionOrder[self.missionsFinished] = missions[0].name
            #     self.missionsFinished += 1
            return (1, missions[0])
        #Ally and Player Actions (8-11)
        allyPlayerAbilities = [action for action in actions if (action[0] in [8, 9, 10, 11])]
        if allyPlayerAbilities:
            return allyPlayerAbilities[0]
        """
        ideas for burning metals, playing cards, etc
        
        possible priorities:
        playing most cards possible, highest rating to lowest rating
        playing most cards possible, highest cost to lowest cost
        playing most abilities on each card, highest rating to lowest rating
        playing most abilities on each card, highest cost to lowest cost
        """
        
        handScores = sorted([(card, self.sorting_algo(card)) for card in self.deck.hand], key=lambda x:x[1], reverse=True) #testing
        # print(handScores, actions)
        for card, score in handScores:
            if isinstance(card, Action) and (not card.burned) and card.metalUsed < card.capacity:
                if (4, card) in actions:
                    # print(f"did {(4, card)}")
                    return (4, card)
                if (3, card, card.metal) in actions:
                    refreshes = sorted([action for action in actions if action[0] == 3], key=lambda x: self.sorting_algo(x[1]))
                    # print(refreshes[0])
                    return refreshes[0]
                if (self.metalTokens[:-1].count(1) + self.metalTokens[-1]) < self.burns and (5, card.metal) in actions:
                    # print(f"burned {(5, card.metal)} for {card}")
                    return (5, card.metal)
                if game.turncount < 6:
                    # print(f"flared {(5, card.metal)} for {card}")
                    return (5, card.metal)
                cur, burning = handScores.index((card, score)), len(handScores) - 1
                while cur < burning:
                    if (2, handScores[burning][0], card.metal) in actions:
                        return (2, handScores[burning][0], card.metal)
                    burning -= 1
                if (12, card.metal) in actions:
                    return (12, card.metal)
                # if (5, 8) in actions and (self.charAbility3 and self.training >= 13):  #testing
                #     return (5, 8)
        
        extraneousBurns = [action for action in actions if action[0] == 2]
        if extraneousBurns:
            return extraneousBurns[0]
        
        metal_prio = [(c, c.metal) for c in self.allies if (c.available2 and self.metalBurned[c.metal] > 1)] + [(c, c.metal) for c in self.allies if c.available1]
        for c, m in metal_prio:
            if (5, m) in actions:
                return (5, m)
            for c2 in self.deck.hand:
                if (2, c2, m) in actions:
                    return (2, c2, m)
        selfMetal = int(self.ability1metal)
        if (self.charAbility1 and self.training >= 5):
            if (5, selfMetal) in actions:
                return (5, selfMetal)
            for c in self.deck.hand:
                if (2, c, selfMetal) in actions:
                    return (2, c, selfMetal)

        if (self.charAbility3 and self.training >= 13):
            for c, m in metal_prio:
                if (12, m) in actions:
                    return (12, m)
                
        for action in actions:
            if action[0] == 3:
                return action

        # print(self.deck.hand)
        # print(self.curMoney, game.market.hand)
        boxingBuys = sorted([action for action in actions if (action[0] == 13 and action[1].cost > 5 and not isinstance(action[1], Ally))], key=lambda x: -1*self.sorting_algo(x[1]))
        buys = sorted([action for action in actions if action[0] == 6 and self.sorting_algo(action[1]) >= self.buffer], key=lambda x: -1*self.sorting_algo(x[1]))
        if len(boxingBuys) > 0:
            # print([(card, self.sorting_algo(card)) for card in game.market.hand], boxingBuys[0], boxingBuys)
            return boxingBuys[0]
        if len(buys) > 0 and (self.curMoney > 2 or [card for card in self.game.market.hand if card.cost > 6 and not isinstance(card, Ally)]):
            # print([(card, self.sorting_algo(card)) for card in game.market.hand], buys[0], buys)
            return buys[0]
        
        self.seekCount = 0
        return (0,)

    
    def senseCheckIn(self, card):
        #return a bool to use the sense ability
        return True

    def killEnemyAllyIn(self, allies):
        #return the index of the ally to kill or -1 to not kill any
        if len(allies) == 0:
            return -1
        # HammerBot always kills the ally with the highest health
        ally_healths = [(i, target.health) for i, target in enumerate(allies)]
        ally_healths.sort(key=lambda x: x[1])
        return ally_healths[-1][0]
    
    def cloudAlly(self, card, ally):
        #return a bool to discard card to save ally 
        return False
    
    def eliminateIn(self):
        #return the index of the card to be eliminated or -1 to not eliminate. Indexing goes hand, discard
        h = len(self.deck.hand)
        d = len(self.deck.discard)
        c = len(self.deck.cards)
        if d+h+c < 6:
            return -1
        for c in self.deck.hand:
            if isinstance(c, Funding):
                return self.deck.hand.index(c)
        for c in self.deck.discard:
            if isinstance(c, Funding):
                return self.deck.discard.index(c) + h
        cards = [(thing[0], thing[1], self.sorting_algo(thing[1])) for thing in enumerate(self.deck.hand + self.deck.discard) if self.sorting_algo(thing[1]) < self.buffer]
        if not cards:
            return -1
        else:
            elimThrouple = min(cards, key=lambda x:x[2])
            return elimThrouple[0]
        
    
    def pullIn(self):
        #return the index of the card to be pulled or -1 to not pull.
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(self.deck.discard) if self.sorting_algo(c) > self.buffer]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1
    
    def subdueIn(self, choices):
        #return the index of the card to gain. All are options are valid targets -1 to pick nothing
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices) if self.sorting_algo(c) > self.buffer]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1
    
    def soarIn(self, choices):
        #return the index of the eliminated card to buy or -1 to not
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices) if self.sorting_algo(c) > self.buffer]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1

    def confrontationIn(self, choices):
        #return the index of the card to use it's first ability or -1 to not
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices) if self.sorting_algo(c) > self.buffer]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1
    
    def informantIn(self, card):
        #return a bool to decide if card is removed from top of deck
        d = self.sorting_algo(card)
        if d > 0.5:
            return 0
        else:
            return 1
        
    def keeperIn(self, choices):
        #return the index of the card in play to be set aside
        return -1
    
    def chooseIn(self, options):
        #each effect takes two indices. for the first effect return 0, and for the second return 2 etc.
        if 'Mi' in options:
            return options.index('Mi')//2
        elif 'T' in options:
            return options.index('T')//2
        elif 'M' in options:
            return options.index('M')//2
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
        choices = self.game.market.hand
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices) if self.sorting_algo(c) > self.buffer]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) > 0:
            return sortedChoices[-1][0]
        return -1
    
    def riotIn(self, riotable):
        #choose the ally from the list of valid allies to riot
        choices = riotable
        sortedChoices = [(c, self.sorting_algo(c)) for i, c in enumerate(choices)]
        sortedChoices.sort(key=lambda x: x[1])
        return sortedChoices[-1][0]

    
    def seekIn(self, twice, seeker, choices):
        #im not going to try to explain this one... Henry I blame you for what's going on here
        self.seekCount += 1
        if self.seekCount > 100:
            return -1, -1
        sortedChoices = [(i, self.sorting_algo(c)) for i, c in enumerate(choices)]
        sortedChoices.sort(key=lambda x: x[1])
        if len(sortedChoices) == 1 or not twice:
            return sortedChoices[-1][0], -1
        elif len(sortedChoices):
            return sortedChoices[-1][0], sortedChoices[-2][0]
        return -1, -1
    
    def cloudP(self, card):
        #return a bool to decide if the card should be discarded to cloudp
        if card.name == "Coppercloud":
            return True
        else:
            return False