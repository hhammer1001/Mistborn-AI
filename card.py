class Card():

    def __init__(self, data, deck):
        #data = [name, Cost,metal code,ability 1,abil 1 amt,ability 2,abil 2 amt,ability 3,abil 3 amt,activ abil,activ amt,burn abil,burn amt]
        self.data = data
        self.name = self.data[0]
        self.deck = deck
        self.cost = int(data[1])
        self.metal = int(data[2])
        self.sought = False

    def __repr__(self):
        return self.name

class Action(Card):
    def __init__(self, data, deck):
        #data = [name, Cost,metal code,ability 1,abil 1 amt,ability 2,abil 2 amt,ability 3,abil 3 amt,activ abil,activ amt,burn abil,burn amt]
        super().__init__(data, deck)
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
        ability = self.data[(self.metalUsed + 1)*2 - 1]
        if ability != '':
            player.resolve(ability, self.data[(self.metalUsed + 1)*2])

    def ability1(self, player):
        player.resolve(self.data[3], self.data[4])
    
    
    def reset(self):
        self.burned = False
        self.metalUsed = 0
    



class Ally(Card):
    def __init__(self, data, deck):
        #data = [name,Cost,metal code,ability 1,abil 1 amt,ability 2,abil 2 amt,activ abil,activ amt,burn abil,burn amt]
        super().__init__(data, deck)
        self.available1 = False
        self.available2 = False
        self.availableRiot = False
        self.reset()
        self.health = int(self.data[7])
        self.defender = (self.data[9] == 'D')

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
    def play(self,player):
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
    def reset(self):
        return

