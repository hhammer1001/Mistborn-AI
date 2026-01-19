from game import Game
from robot import FocusBot, RandomBot, SynergyBot, SynergyBotPrime, Twonky
from matplotlib import pyplot as plt


import json




def main():
    # going first 6824
    # going second 5369
    separator = '|'
    learnRate = 0.00
    chars = ['Kelsier', 'Shan', 'Vin', 'Marsh', 'Prodigy']
    charDict = {}
    for char in chars:
        charDict[char] = 0
    keys = [char + "0" for char in chars] + [char + "1" for char in chars]
    synDict = {}
    cardDict = {}
    for key in keys:
        try:
            with open(f"synergyData1/{key}.json", 'r') as f:
                tempdata = json.load(f)
        except:
            print(key)
        synDict[key] = {tuple(old_key.split('|')): value for old_key, value in tempdata.items()}


    with open(f"cardData.json", 'r') as f:
        cardDict = json.load(f)
    xs = []
    ys = []
    cont = True

    dic = {"Twonky": 0,
        "SynergyBot": 0}
    
    for z in range(1000000):
        p = [Twonky,
                    SynergyBot]

        if z % 2 == 0:
            p = [p[1], p[0]]
        g = Game(players = p, randChars = True)
        winner = g.play()
        loser = g.players[(winner.turnOrder + 1)%2]
        charDict[winner.character] = charDict[winner.character] + 1

        goodCards = winner.deck.hand + winner.deck.cards + winner.deck.discard
        xs.append(len(goodCards))
        
        badCards = loser.deck.hand + loser.deck.cards + loser.deck.discard
        ys.append(len(badCards))

        goodKey = f"{winner.character}{winner.turnOrder}"
        badKey = f"{loser.character}{loser.turnOrder}"


        for i in range(len(goodCards)):
            for j in range(i+1, len(goodCards)):
                if goodCards[i].name < goodCards[j].name:
                    try:
                        synDict[goodKey][(goodCards[i].name, goodCards[j].name)] = synDict[goodKey][(goodCards[i].name, goodCards[j].name)] * (1 - learnRate) + 2*learnRate
                    except:
                        synDict[goodKey][(goodCards[i].name, goodCards[j].name)] = 1.0
                else:
                    try:
                        synDict[goodKey][(goodCards[j].name, goodCards[i].name)] = synDict[goodKey][(goodCards[j].name, goodCards[i].name)] * (1 - learnRate) + 2*learnRate
                    except:
                        synDict[goodKey][(goodCards[j].name, goodCards[i].name)] = 1.0
        for i in range(len(badCards)):
            for j in range(i+1, len(badCards)):
                if badCards[i].name < badCards[j].name:
                    try:
                        synDict[badKey][(badCards[i].name, badCards[j].name)] = synDict[badKey][(badCards[i].name, badCards[j].name)] * (1 - learnRate)
                    except:
                        synDict[badKey][(badCards[i].name, badCards[j].name)] = 1.0
                else:
                    try:
                        synDict[badKey][(badCards[j].name, badCards[i].name)] = synDict[badKey][(badCards[j].name, badCards[i].name)] * (1 - learnRate) 
                    except:
                        synDict[badKey][(badCards[j].name, badCards[i].name)] = 1.0

        if((winner.turnOrder % 2) == z % 2):

            dic["SynergyBot"] += 1
        else:
            dic["Twonky"] += 1


        if((z + 1) % 250 == 0):
            conf = ( 2 * dic["SynergyBot"] - z) / (z ** (1/2))
            print(dic)
            print(conf)
            for key in synDict.keys():
                tempdata = {separator.join(old_key): value for old_key, value in synDict[key].items()}

                while(True):
                    try:
                        with open(f"synergyData1/{key}.json", "w") as f:
                            json.dump(tempdata, f, indent=4) # indent for pretty-printing
                        break
                    except:
                        continue
        
        




                
    plt.hist(xs)
    plt.savefig("hubbins.png")
    plt.clf()
    plt.hist(ys)
    plt.savefig("tina.png")

if __name__ == '__main__':
    main()