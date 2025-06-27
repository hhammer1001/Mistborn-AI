import csv
from card import Funding, Ally, Action
from player import Player
import random

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
    

class HammerBot(Player):
    def get_starters(self):
        starter_names = []
        with open('starterdecks.csv', newline='') as csvfile:
            lines = csv.reader(csvfile, delimiter=',', quotechar='|')
            for row in lines:
                starter_names += [row[2]]
        return starter_names
    
    def get_damage(self, card):
        #return the damage value of the card
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
        if len(actions) == 1:
            return actions[0]
        else:
            return random.choice(actions[1:])
    
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
            0
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
        
