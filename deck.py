class Deck():

    def __init__(self, gameName):
        self.game = gameName

    def flip(self):
        for x in range(6-len(self.game.market)):
            newCard = self.draw(1)[0]
            self.game.market += [newCard]
            print(f"{newCard} added to market")
    


class PlayerDeck(Deck):

    def __init__(self, gameName, code):
        super().__init__(gameName)
        self.hand = []
        self.cards = []
        if code in ['Kelsier', 'Shan']:
            for c in deckInfo[0]:
                data = cardLookup[c]
                self.cards += [Card(c, data, self)]
        elif code in ['Vin', 'Marsh', 'Prodigy']:
            pass
        
        self.discard = []
        self.inPlay = []
    
    def __repr__(self):
        out = self.cards + self.discard + self.hand + self.inPlay
        return str(out)
    
    def draw(self, amount):
        for i in range(amount):
            if self.cards == []:
                self.discard = self.cards
                random.shuffle(self.cards)
                if self.cards == []:
                    pass
            self.hand += [self.cards.pop(0)]
    
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