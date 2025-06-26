from game import Game
from robot import RandomBot

def main():
    dic = {"Kaladin": 0,
    "Jasnah": 0}
    for i in range(10):
        g = Game(randos = True)
        winner = g.play()
        dic[winner.name] += 1
        
        print(f"The winner is {winner}!!!!!")
    print(dic)

if __name__ == '__main__':
    main()