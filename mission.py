class Mission():

    def __init__(self, name, game, tiers):
        self.name = name
        self.game = game
        self.tiers = self.game.missionTiers[name]
        self.playerRanks = [0 for i in range(game.numPlayers)]
        
    def progress(self, playerNum, amount):
        old = self.playerRanks[playerNum]
        new = self.playerRanks[playerNum] + amount
        for tier in self.tiers:
            if old < tier[0] and new >= tier[0]:
                self.game.players[playerNum].missionFuncs[tier[1]](tier[2])
                if max(self.playerRanks) < tier[0]:
                    self.game.players[playerNum].missionFuncs[tier[3]](tier[4])
        
        self.playerRanks[playerNum] = new
        self.game.missionVictoryCheck(playerNum)
    
    def display(self):
        return f"Progress on {self.name} is {self.playerRanks}, tiers are {self.tiers}"

    def __repr__(self):
        return f"{self.name} and {self.playerRanks}"