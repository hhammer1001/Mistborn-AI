class Card():

    def __init__(self, data, deck):
        #data = [name, Cost,metal code,ability 1,abil 1 amt,ability 2,abil 2 amt,ability 3,abil 3 amt,activ abil,activ amt,burn abil,burn amt]
        self.name = data[0]
        self.deck = deck
        self.cost = data[1]
        self.metal = data[2]
        # self.ability1 = [zip(data[3].split("."), data[4].split("."))]
        # self.ability1


    def play(self, owner):
        for func, arg in self.ability1:
            self.deck.owner.missionFuncs[func](int(arg))
        self.deck.inPlay += [self]
        #TODO

    def __repr__(self):
        return self.name

class Action(Card):
    def __init__(self, data, deck):
        #data = [name, Cost,metal code,ability 1,abil 1 amt,ability 2,abil 2 amt,ability 3,abil 3 amt,activ abil,activ amt,burn abil,burn amt]
        super().__init__(data, deck)
        self.data = data
        if self.data[8] == '':
            if self.data[6] == '':
                self.capacity = 1
            else:
                self.capacity = 2
        else: 
            self.capacity = 3
        
        self.metalUsed = 0
        self.burned = False

    
    def burn(self, player):
        self.burned == True
        if (self.data[12] != ''):
            player.resolve(self.data[11],self.data[12])
    
    def addMetal(self, player):
        self.metalUsed += 1
        ability = self.data[(self.metalUsed + 1)*2]
        if ability != '':
            player.resolve(ability, self.data[(self.metalUsed + 1)*2 + 1])

    def ability1(self, player):
        player.resolve(self.data[3], self.data[4])
    
    
    def reset(self):
        self.burned = False
        self.metalUsed = 0
    
    # def activate(self, player):
    #     #todo



class Ally(Card):
    def __init__(self, data, deck):
        #data = [name, Cost,metal code,ability 1,abil 1 amt,ability 2,abil 2 amt,ability 3,abil 3 amt,activ abil,activ amt,burn abil,burn amt]
        super().__init__(data, deck)
        self.available1 = False
        self.available2 = False
        self.availableRiot = False
        self.reset()
        self.taunt = (self.data[9] == 'D')
        # self.ability1
    def reset(self):
        if self.data[3] != '':
            self.available1 = True
            self.availableRiot = True
            if self.data[5] != '':
                self.available2 = True
    
    def ability1(self, player):
        player.resolve(self.data[3], self.data[4])
        self.available1 = False
    def ability2(self, player):
        player.resolve(self.data[5], self.data[6])
        self.available2 = False
    def riot(self, player):
        player.resolve(self.data[3], self.data[4])
        self.availableRiot = False
    # def activate():
    #     if self.used1:
    #         self.used2 = True
    #         return self.2
    #     self.used1 = True
    #     return self.1
    def play(self,owner):
        if self.data[0] == "Noble":
            player.extraBurn(1)
        if self.data[0] == "Crewleader":
            player.permDraw(1)
        if self.data[0] == "Smoker":
            player.smoking = True

class Funding(Card):
    def __init__(self, data, deck):
        super().__init__(data, deck)
    def play(self, owner):
        owner.money(1)

