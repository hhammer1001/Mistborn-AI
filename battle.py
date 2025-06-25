from game import Game
from robot import RandomBot

def main():
    for i in range(10):
        g = Game(randos = True)
        winner = g.play()
        print(f"The winner is {winner}!!!!!")

if __name__ == '__main__':
    main()