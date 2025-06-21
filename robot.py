import csv
from card import Funding, Ally, Action
from player import Player

class RandomBot(Player):
    def assignDamageIn(self, targets):
        #choose the index of the ally to kill by assigning damage to it or return -1 to go to player damage
        pass

    def selectAction(self, actions, game):
        #choose and return one of the actions in the list
        pass
    
    def senseCheckIn(self, card):
        #return a bool to use the sense ability
        pass

    def killEnemyAllyIn(self, allies):
        #return the index of the ally to kill or -1 to not kill any
        pass
    
    def cloudAlly(self, card, ally):
        #return a bool to discard card to save ally 
        pass
    
    def eliminateIn(self):
        #return the index of the card to be eliminated or -1 to not eliminate. Indexing goes hand, discard
        pass
    
    def pullIn(self):
        #return the index of the card to be pulled or -1 to not pull.
        pass
    
    def subdueIn(self, choices):
        #return the index of the card to gain. All are options are valid targets -1 to pick nothing
        pass
    
    def soarIn(self, choices):
        #return the index of the eliminated card to buy or -1 to not
        pass

    def confrontationIn(self, choices):
        #return the index of the card to use it's first ability or -1 to not
        pass
    
    def informantIn(self, card):
        #return a bool to decide if card is removed from top of deck
        pass

    def keeperIn(self, choices):
        #return the index of the card in play to be set aside
        pass
    
    def chooseIn(self, options):
        #each effect takes two indices. for the first effect return 0, and for the second return 2 etc.
        pass
    
    def refreshIn(self):
        #return the index of the metal to refresh
        pass

    def pushIn(self):
        #return the index of the market card to push
        pass
    
    def riotIn(self, riotable):
        #choose the ally from the list of valid allies to riot
        pass
    
    def seekIn(self, twice, choices):
        #im not going to try to explain this one... Henry I blame you for what's going on here
        pass
    
    def cloudP(self, card):
        #return a bool to decide if the card should be discarded to cloudp
        pass