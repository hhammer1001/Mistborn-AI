import random
import csv
from card import Funding, Action, Ally

class Deck():

    def __init__(self, gameName):
        self.game = gameName
        self.hand = []
        self.cards = []
        self.discard = []
    
    def draw(self, amount):
        for i in range(amount):
            if self.cards == []:
                self.discard = self.cards
                random.shuffle(self.cards)
                if self.cards == []:
                    pass
            self.hand += [self.cards.pop(0)]

    def __repr__(self):
        out = self.cards + self.discard + self.hand
        return str(out)
    
    def dataToCard(self, data):
        match int(data[0]):
            case 1:
                return Funding(data[1:], self)
            case 2:
                return Action(data[1:], self)
            case 3:
                return Ally(data[1:], self)


    


class PlayerDeck(Deck):

    def __init__(self, gameName, code):
        super().__init__(gameName)
        deckInfo = {0:[], 1:[]}
        with open('starterdecks.csv', newline='') as csvfile:
            lines = csv.reader(csvfile, delimiter=',', quotechar='|')
            fixedLines = []
            for row in lines:
                deckInfo[int(row[0])] += [row[1:]]
        if code in ['Kelsier', 'Shan']:
            for c in deckInfo[0]:
                self.cards += [self.dataToCard(c)]
        elif code in ['Vin', 'Marsh', 'Prodigy']:
            for c in deckInfo[1]:
                self.cards += [self.dataToCard(c)]
        random.shuffle(self.cards)
    
    def __repr__(self):
        out = self.cards + self.discard + self.hand
        return str(out)
    
    
    
    def cleanUp(self, player):
        for card in self.hand:
            card.reset
        self.discard += self.hand
        self.hand = []
        self.draw(player.handSize)
    
    def playAllies(self, player):
        allies = []
        for card in self.hand:
            if isinstance(card, Ally):
                self.hand.remove(card)
                allies += [card]
        player.allies += allies

        

    def eliminate(self, choice):
            h = len(self.hand)
            p = len(self.inPlay)
            d = len(self.discard)
            if choice < h:
                self.deck.hand = self.deck.hand[:choice] + self.deck.hand[choice+1:]
            elif choice < h+p:
                self.deck.inPlay = self.deck.inPlay[:choice-h] + self.deck.inPlay[choice-h+1:]
            else:
                self.deck.discard = self.deck.discard[:choice-h-p] + self.deck.discard[choice-h-p+1:]
    
    def add(self, card):
        self.discard += [card]


    

class Market(Deck):
    def __init__(self, gameName):
        super().__init__(gameName)
        #TODO self.cards = 
        random.shuffle(self.cards)
        self.draw(6)  
    
    def buy(self, choice):
        self.hand.remove(choice)
        self.draw(1)

        
