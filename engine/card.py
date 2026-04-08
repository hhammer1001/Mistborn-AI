METAL_NAMES = ["pewter", "tin", "bronze", "copper", "zinc", "brass", "iron", "steel", "atium"]

_next_card_id = 0

class Card():

    def __init__(self, data, deck):
        global _next_card_id
        #data = [name, Cost,metal code,ability 1,abil 1 amt,ability 2,abil 2 amt,ability 3,abil 3 amt,activ abil,activ amt,burn abil,burn amt]
        self.id = _next_card_id
        _next_card_id += 1
        self.data = data
        self.name = self.data[0]
        self.deck = deck
        self.cost = int(data[1])
        self.metal = int(data[2])
        self.sought = False

    def __repr__(self):
        return self.name

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "type": "card",
            "cost": self.cost,
            "metal": self.metal,
            "metalName": METAL_NAMES[self.metal] if self.metal < len(METAL_NAMES) else "unknown",
            "sought": self.sought,
        }

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

    
    def to_dict(self):
        d = super().to_dict()
        d["type"] = "action"
        d["capacity"] = self.capacity
        d["metalUsed"] = self.metalUsed
        d["burned"] = self.burned
        d["abilities"] = []
        for i in range(self.capacity):
            idx = 3 + i * 2
            if self.data[idx] != '':
                d["abilities"].append({"effect": self.data[idx], "amount": self.data[idx + 1]})
        if self.data[9] != '':
            d["activeAbility"] = {"effect": self.data[9], "amount": self.data[10]}
        if self.data[11] != '':
            d["burnAbility"] = {"effect": self.data[11], "amount": self.data[12]}
        return d

    def burn(self, player):
        self.burned = True
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
    
    def to_dict(self):
        d = super().to_dict()
        d["type"] = "ally"
        d["health"] = self.health
        d["defender"] = self.defender
        d["available1"] = self.available1
        d["available2"] = self.available2
        d["abilities"] = []
        if self.data[3] != '':
            d["abilities"].append({"effect": self.data[3], "amount": self.data[4]})
        if self.data[5] != '':
            d["abilities"].append({"effect": self.data[5], "amount": self.data[6]})
        return d

    def ability1(self, player):
        player.resolve(self.data[3], self.data[4])
        self.available1 = False
    def ability2(self, player):
        player.resolve(self.data[5], self.data[6])
        self.available2 = False
    def riot(self, player):
        self.availableRiot = False
        player.resolve(self.data[3], self.data[4])
        
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

    def to_dict(self):
        d = super().to_dict()
        d["type"] = "funding"
        return d

    def play(self, owner):
        owner.money(1)
    def reset(self):
        return

