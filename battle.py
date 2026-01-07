from game import Game
from robot import RandomBot, FocusBot, HammerBot, Twonky, EmployedTwonky


import json

def countHelper(name, cards):
    counter = 0
    for c in cards:
        if c.name == name:
            counter += 1
    return counter


def main():
    char = {char: 0 for char in ['Kelsier', 'Shan', 'Vin', 'Marsh', 'Prodigy']}
    b0 = {'M':0, 'D':0, 'C':0, 'T':0}
    b1 = {'M':0, 'D':0, 'C':0, 'T':0}
    cardTracker = {}
    synergyTracker = {}
    mTracker = {}
    dTracker = {}
    cTracker = {}
    winDics = [('M', mTracker), ('D', dTracker), ('C', cTracker)]
    dic = {}
    for games in range(500000):
        # print("______NEW GAME______")
        # g = Game(randChars=True, bots=[FocusBot, Twonky])
        g = Game(randChars=True, bots=[Twonky, Twonky])
        winner = g.play()
        loser = g.players[(winner.turnOrder + 1)%2]
        goodCards = winner.deck.hand + winner.deck.cards + winner.deck.discard
        badCards = loser.deck.hand + loser.deck.cards + loser.deck.discard
        char[winner.character] += 1
        
        #card ratings
        for card in goodCards:
            if card.name in cardTracker:
                cardTracker[card.name] = [cardTracker[card.name][0] + 1, cardTracker[card.name][1] + 1]
            else:
                cardTracker[card.name] = [1, 1]
        for card in badCards:
            if card.name in cardTracker:
                cardTracker[card.name] = [cardTracker[card.name][0] - 1, cardTracker[card.name][1] + 1]
            else:
                cardTracker[card.name] = [-1, 1]
                
        #card-card synergies
        for i in range(len(goodCards)):
            for j in range(i+1, len(goodCards)):
                tup = sorted([goodCards[i].name, goodCards[j].name])
                tup = tup[0] + '-' + tup[1]
                if tup in synergyTracker:
                    synergyTracker[tup] = [synergyTracker[tup][0] + 1, synergyTracker[tup][1] + 1]
                else:
                    synergyTracker[tup] = [1, 1]
        for i in range(len(badCards)):
            for j in range(i+1, len(badCards)):
                tup = sorted([badCards[i].name, badCards[j].name])
                tup = tup[0] + '-' + tup[1]
                if tup in synergyTracker:
                    synergyTracker[tup] = [synergyTracker[tup][0] - 1, synergyTracker[tup][1] + 1]
                else:
                    synergyTracker[tup] = [-1, 1]    
        
        #card win types
        for card in goodCards:
            for winType, d in winDics:
                if winType == g.victoryType:
                    if card.name in d:
                        d[card.name] = [d[card.name][0] + 1, d[card.name][1] + 1]
                    else:
                        d[card.name] = [1, 1]
                else:
                    if card.name in d:
                        d[card.name] = [d[card.name][0] - 1, d[card.name][1] + 1]
                    else:
                        d[card.name] = [-1, 1]
        if winner.turnOrder == 0:
            b0[g.victoryType] += 1
        else:
            b1[g.victoryType] += 1
        # for card in goodCards:
        #     if card.name in carddict:
        #         carddict[card.name] = 0.5
        #     else:
        #         carddict[card.name] = 0.5
        # for card in badCards:
        #     if card.name in carddict:
        #         carddict[card.name] = 0.5
        #     else:
        #         carddict[card.name] = 0.5
        if winner.name in dic:
            dic[winner.name] += 1
        else:
            dic[winner.name] = 1
        if((games + 1) % 1000 == 0):
            print(dic)
    
    print(b0)
    print(b1)
    print(char)
    
    for card in cardTracker:
        cardTracker[card] += [cardTracker[card][0]/cardTracker[card][1]]
    for card in synergyTracker:
        synergyTracker[card] += [synergyTracker[card][0]/synergyTracker[card][1]]
    winDic = {}
    for name, d in winDics:
        for card in d:
            d[card] += [d[card][0]/d[card][1]]
        winDic[name] = d
            
    with open("wins1.json", "w") as f:
        json.dump(cardTracker, f, indent=4)
    with open("categor1.json", "w") as f:
        json.dump(winDic, f, indent=4)
    with open("syns1.json", 'w') as f:
        json.dump(synergyTracker, f, indent=4)

if __name__ == '__main__':
    main()

