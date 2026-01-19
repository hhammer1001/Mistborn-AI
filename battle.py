from game import Game
from robot import RandomBot, FocusBot, HammerBot, Twonky, CharacterTwonky, EmployedTwonky, TestingTwonky
import numpy as np
import random


import json


ALL_CHARACTERS = ['Kelsier', 'Shan', 'Vin', 'Marsh', 'Prodigy']

def countHelper(name, cards):
    counter = 0
    for c in cards:
        if c.name == name:
            counter += 1
    return counter


def main():
    # characters = ['Kelsier', 'Shan', 'Vin', 'Marsh', 'Prodigy']
    # n = len(characters)
    # subsets = {}
    # for mask in range(1, 1 << n):
        # subsets[tuple([characters[i] for i in range(n) if mask & (1 << i)])] = 0
    # subsets = {(('Vin',), buffer):0 for buffer in list(np.arange(0, 0.2, 0.01))}
    subsets = [0]
    for subset in subsets:
        print(subset)
        char = {char: [0, 0.00000001] for char in ALL_CHARACTERS}
        charCards = {char: {} for char in ALL_CHARACTERS}
        b0 = {'M':0, 'D':0, 'C':0, 'T':0}
        b1 = {'M':0, 'D':0, 'C':0, 'T':0}
        cardTracker = {}
        synergyTracker = {}
        mTracker = {}
        dTracker = {}
        cTracker = {}
        winDics = [('M', mTracker), ('D', dTracker), ('C', cTracker)]
        dic = {}
        turnCountsM = []
        turnCountsD = []
        missionTracker = {}
        jobData = {}
        for games in range(10000):
            # print("______NEW GAME______")
            if games % 2 == 0:
                boys = [TestingTwonky, TestingTwonky]
                # boys = [FocusBot, TestingTwonky]
                # g = Game(randChars=False, chars=[ALL_CHARACTERS[games%5]] + ['Vin'], bots=boys, mults=subset)
            else:
                # boys = [TestingTwonky, FocusBot]
                boys = [TestingTwonky, TestingTwonky]
                # g = Game(randChars=False, chars=['Vin'] + [ALL_CHARACTERS[games%5]], bots=boys, mults=subset)
            g = Game(randChars=False, chars=[ALL_CHARACTERS[games%5], ALL_CHARACTERS[(games//5)%5]], bots=boys, mults=subset)

            winner = g.play()
            loser = g.players[(winner.turnOrder + 1)%2]
            goodCards = winner.deck.hand + winner.deck.cards + winner.deck.discard
            badCards = loser.deck.hand + loser.deck.cards + loser.deck.discard
            if winner.name in ['TestingTwonky', 'TestingTwonky2']:
                char[winner.character] = [char[winner.character][0] + 1, char[winner.character][1] + 1]
            else:
                char[loser.character] = [char[loser.character][0], char[loser.character][1] + 1]
            if g.victoryType == 'M':
                turnCountsM += [g.turncount]
            else:
                turnCountsD += [g.turncount]
            
            if winner.name in ['TestingTwonky', 'TestingTwonky2']:
                outcome = f'Won {g.victoryType}'
                job = winner.job
                outcomeStr = f'Pred {job}, {outcome}'
                if outcomeStr in jobData:
                    jobData[outcomeStr] += 1
                else:
                    jobData[outcomeStr] = 1
            elif loser.name in ['TestingTwonky', 'TestingTwonky2']:
                outcome = 'Lost'
                job = loser.job
                outcomeStr = f'Pred {job}, {outcome}'
                if outcomeStr in jobData:
                    jobData[outcomeStr] += 1
                else:
                    jobData[outcomeStr] = 1

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

            #character card winrates
            for card in goodCards:
                if card.name in charCards[winner.character]:
                    charCards[winner.character][card.name] = [charCards[winner.character][card.name][0] + 1, charCards[winner.character][card.name][1] + 1]
                else:
                    charCards[winner.character][card.name] = [1, 1]
            for card in badCards:
                if card.name in charCards[loser.character]:
                    charCards[loser.character][card.name] = [charCards[loser.character][card.name][0] - 1, charCards[loser.character][card.name][1] + 1]
                else:
                    charCards[loser.character][card.name] = [-1, 1]

            # for key, value in winner.missionOrder.items():
            #     if value not in missionTracker:
            #         missionTracker[value] = [key]
            #     else:
            #         missionTracker[value] += [key]

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
        for character in char:
            char[character] = char[character][0]/char[character][1]
        print(char)
        print(f'Mission turn Count average, high, low was: {[sum(turnCountsM)/len(turnCountsM), max(turnCountsM), min(turnCountsM)]}')
        print(f'Damage turn Count average, high, low was: {[sum(turnCountsD)/len(turnCountsD), max(turnCountsD), min(turnCountsD)]}')

        for card in cardTracker:
            cardTracker[card] += [cardTracker[card][0]/cardTracker[card][1]]
        for card in synergyTracker:
            synergyTracker[card] += [synergyTracker[card][0]/synergyTracker[card][1]]
        for charDict in charCards:
            for card in charCards[charDict]:
                charCards[charDict][card] += [charCards[charDict][card][0]/charCards[charDict][card][1]]
        winDic = {}
        for name, d in winDics:
            for card in d:
                d[card] += [d[card][0]/d[card][1]]
            winDic[name] = d
        # subsets[tuple(subset)] = [dic['CharacterTwonky'], char[subset[0][0]]]

    # print(subsets)
    # print(max(subsets.items(), key=lambda x:x[1][1]))

    # with open("wins2.json", "w") as f:
    #     json.dump(cardTracker, f, indent=4)
    # with open("categor2.json", "w") as f:
    #     json.dump(winDic, f, indent=4)
    # with open("syns2.json", 'w') as f:
    #     json.dump(synergyTracker, f, indent=4)
    # with open("misses1.json", 'w') as f:
    #     json.dump(missionTracker, f, indent=4)
    # for charName in charCards:
    #     with open(f"{charName}3.json", 'w') as f:
    #         json.dump(charCards[charName], f, indent=4)
    
    with open("jobs2.json", 'w') as f:
        json.dump(jobData, f, indent=4)
if __name__ == '__main__':
    main()

