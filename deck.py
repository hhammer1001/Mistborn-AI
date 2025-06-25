import random
import csv
from card import Funding, Action, Ally

class Deck():

    def __init__(self, game):
        self.game = game
        self.hand = []
        self.cards = []
        self.discard = []
        self.setAside = []
    
    def draw(self, amount):
        for i in range(amount):
            if self.cards == []:
                self.cards = self.discard 
                self.discard = []
                random.shuffle(self.cards)
                if self.cards == []:
                    return
            self.hand += [self.cards.pop(0)]

    def __repr__(self):
        return f"Deck: {str(self.cards)} \n Discard: {str(self.discard)} \n Hand: {str(self.hand)}"
    
    def dataToCard(self, data):
        match int(data[0]):
            case 1:
                return Funding(data[1:], self)
            case 2:
                return Action(data[1:], self)
            case 3:
                return Ally(data[1:], self)


    


class PlayerDeck(Deck):

    def __init__(self, game, code):
        super().__init__(game)
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
        self.draw(6)
    
    def __repr__(self):
        out = f"Hand: {self.hand}"
        return str(out)
    
    
    
    def cleanUp(self, player):
        for card in self.hand:
            card.reset()
        self.discard += self.hand
        self.hand = []
        self.draw(player.handSize)
        self.hand += self.setAside
        self.setAside = []
        for card in self.game.market.hand:
            card.sought = False
    
    def playAlliesandFunding(self, player):
        allies = []
        for card in self.hand:
            if isinstance(card, Ally):
                self.hand.remove(card)
                card.play(player)
                allies += [card]
            if isinstance(card, Funding):
                card.play(player)
        player.allies += allies

    def eliminate(self, choice):
            h = len(self.hand)
            d = len(self.discard)
            if choice < h:
                r = self.hand[choice]
                self.hand = self.hand[:choice] + self.hand[choice+1:]
                return r
            else:
                r = self.discard[choice - h]
                self.discard = self.discard[:choice-h] + self.discard[choice-h+1:]
                return r

    def add(self, card):
        self.discard += [card]


    

class Market(Deck):
    def __init__(self, game):
        super().__init__(game)
        with open('marketdeck.csv', newline='') as csvfile:
            lines = csv.reader(csvfile, delimiter=',', quotechar='|')
            for row in lines:
                self.cards += [self.dataToCard(row)]
        random.shuffle(self.cards)
        self.draw(6)  
    
    def buy(self, choice):
        self.hand.remove(choice)
        self.draw(1)
    
    def __repr__(self):
        return f"Market: {str(self.hand)}"

        
