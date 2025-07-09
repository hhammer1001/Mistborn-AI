from game import Game
from robot import RandomBot


import json




def main():
    with open("cardData.json", 'r') as f:
        carddict = json.load(f)
    dic = {"Kaladin": 0,
    "Jasnah": 0}
    learnRate = 0.1
    for i in range(10000):
        g = Game(randos = True)
        winner = g.play()
        loser = g.players[(winner.turnOrder + 1)%2]
        goodCards = winner.deck.hand + winner.deck.cards + winner.deck.discard
        badCards = loser.deck.hand + loser.deck.cards + loser.deck.discard

        for card in goodCards:
            if card.name in carddict:
                carddict[card.name] = carddict[card.name] * (1 - learnRate) + 2*learnRate
            else:
                carddict[card.name] = 1
        for card in badCards:
            if card.name in carddict:
                carddict[card.name] = carddict[card.name] * (1 - learnRate)
            else:
                carddict[card.name] = 1

        dic[winner.name] += 1
        if((i + 1) % 100 == 0):
            print(dic)
    with open("cardData.json", "w") as f:
        json.dump(carddict, f, indent=4) # indent for pretty-printing

if __name__ == '__main__':
    main()