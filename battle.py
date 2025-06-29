from game import Game
from robot import RandomBot

def main():
    dic = {"Kaladin": 0,
    "Jasnah": 0}
    for i in range(10):
        g = Game(randos = True)
        # g = Game()
        winner = g.play()
        dic[winner.name] += 1
        if(i % 100 == 0):
            print(dic)

if __name__ == '__main__':
    main()