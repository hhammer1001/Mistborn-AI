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
        #return y to use the sense ability and n to not do that
        pass

    def killEnemyAllyIn(self, allies):
        #return the index of the ally to kill or -1 to not kill any
        pass
    
    def cloudAlly(self, card, ally):
        #return y to discard card to save ally or n to not do that
        pass
    
    def eliminateIn(self):
        #return the index of the card to be eliminated or -1 to not eliminate. Indexing goes hand, discard
        pass
    
    def pullIn(self):
        #return the index of the card to be pulled or -1 to not pull.
        pass