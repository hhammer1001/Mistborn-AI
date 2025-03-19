class Card():

    def __init__(self, name, data, deck):
        #data = [Cost,metal code,ability 1,abil 1 amt,ability 2,abil 2 amt,ability 3,abil 3 amt,activ abil,activ amt,burn abil,burn amt]
        self.name = name
        self.deck = deck
        self.cost = data[0]
        self.metal = data[1]
        self.capacity = 0 # todo
        self.ability1 = [zip(data[2].split("."), data[3].split("."))]
        # self.ability1


    def play(self, owner):
        for func, arg in self.ability1:
            self.deck.owner.missionFuncs[func](int(arg))
        self.deck.inPlay += [self]
        #TODO

    def __repr__(self):
        return self.name

class Action(Card):
    def __init__(self, name, data, deck):
        #data = [Cost,metal code,ability 1,abil 1 amt,ability 2,abil 2 amt,ability 3,abil 3 amt,activ abil,activ amt,burn abil,burn amt]
        self.name = name
        self.deck = deck
        self.cost = data[0]
        self.metal = data[1]
        self.ability1 = [zip(data[2].split("."), data[3].split("."))]
        self.burned = False
        self.metalUsed = 0
        # self.ability1
    
    def burn(self, player):
        self.burned == True
        player.burn(metal)
    
    
    def reset(self):
        self.burned = False
        self.metalUsed = 0
    
    def activate(self, player):
        #todo



class Ally(Card):
    def __init__(self, name, data, deck):
        #data = [Cost,metal code,ability 1,abil 1 amt,ability 2,abil 2 amt,ability 3,abil 3 amt,activ abil,activ amt,burn abil,burn amt]
        self.name = name
        self.deck = deck
        self.cost = data[0]
        self.metal = data[1]
        self.ability1 = [zip(data[2].split("."), data[3].split("."))]
        self.used1 = False
        self.used2 = False
        self.rioted = False
        # self.ability1
    def reset(self):
        self.used1 = False
        self.used2 = False
        self.rioted = False
    
    def activate():
        if self.used1:
            self.used2 = True
            return self.2
        self.used1 = True
        return self.1
    def play(self,owner):
        owner.ally(self)

class Funding(Card):
    def play(self, owner):
        owner.money(1)

