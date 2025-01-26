import random

class Deck():

    def __init__(self, player, gameName):
        self.game = gameName
        self.hand = []
        self.cards = []
        self.discard = []
        self.inPlay = []
    
    def draw(self, amount):
        for i in range(amount):
            if self.cards == []:
                self.discard = self.cards
                random.shuffle(self.cards)
                if self.cards == []:
                    pass
            self.hand += [self.cards.pop(0)]

    def __repr__(self):
        out = self.cards + self.discard + self.hand + self.inPlay
        return str(out)

    


class PlayerDeck(Deck):

    def __init__(self, gameName, code):
        super().__init__(gameName)

        if code in ['Kelsier', 'Shan']:
            for c in deckInfo[0]:
                data = cardLookup[c]
                self.cards += [Card(c, data, self)]
        elif code in ['Vin', 'Marsh', 'Prodigy']:
            pass
        random.shuffle(self.cards)
        
        
        self.inPlay = []
    
    def __repr__(self):
        out = self.cards + self.discard + self.hand + self.inPlay
        return str(out)
    
    
    
    def discardHand(self):
        self.discard += self.hand
        self.hand = []

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
    
    def remove(self, choice):
        del self.cards[choice]
        self.draw(1)
