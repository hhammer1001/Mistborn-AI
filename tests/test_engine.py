import pytest
from pathlib import Path
from engine import DATA_DIR


class TestDataDir:
    def test_data_dir_exists(self):
        assert DATA_DIR.is_dir()

    def test_data_dir_is_inside_engine(self):
        assert DATA_DIR.parent.name == "engine"

    @pytest.mark.parametrize("filename", [
        "cardData.json",
        "characters.csv",
        "marketdeck.csv",
        "starterdecks.csv",
        "wins2.json",
        "twonkyMissionData.json",
        "twonkyCardData.json",
        "categor2.json",
    ])
    def test_core_data_files_exist(self, filename):
        assert (DATA_DIR / filename).is_file(), f"Missing data file: {filename}"

    @pytest.mark.parametrize("character", ["Kelsier", "Marsh", "Prodigy", "Shan", "Vin"])
    def test_character_data_files_exist(self, character):
        assert (DATA_DIR / f"{character}3.json").is_file()

    @pytest.mark.parametrize("subdir", ["cardData", "synergyData", "synergyData1"])
    def test_data_subdirectories_exist(self, subdir):
        assert (DATA_DIR / subdir).is_dir()


class TestImports:
    def test_import_card(self):
        from engine.card import Card, Action, Ally, Funding
        assert Card and Action and Ally and Funding

    def test_import_deck(self):
        from engine.deck import Deck, PlayerDeck, Market
        assert Deck and PlayerDeck and Market

    def test_import_player(self):
        from engine.player import Player
        assert Player

    def test_import_mission(self):
        from engine.mission import Mission
        assert Mission

    def test_import_game(self):
        from engine.game import Game
        assert Game

    def test_import_robot_bots(self):
        from engine.robot import RandomBot, EliBot, QualityBot, FocusBot, HammerBot, Twonky, EmployedTwonky
        assert RandomBot and EliBot and QualityBot and FocusBot and HammerBot and Twonky and EmployedTwonky

    def test_import_final_twonky(self):
        from engine.finalTwonky import Twonky
        assert Twonky

    def test_import_training_henryBattle(self):
        from training.henryBattle import main
        assert main

    def test_import_training_convert_json(self):
        from training.convert_json import convert, unconvert
        assert convert and unconvert


class TestGameCreation:
    def test_create_game_default(self):
        from engine.game import Game
        g = Game()
        assert g.numPlayers == 2
        assert len(g.players) == 2
        assert len(g.missions) == 3
        assert len(g.market.hand) == 6

    def test_create_game_with_bots(self):
        from engine.game import Game
        from engine.robot import Twonky
        g = Game(randChars=True, bots=[Twonky, Twonky])
        assert g.players[0].name == "Twonky"

    def test_create_game_all_characters(self):
        from engine.game import Game
        from engine.robot import Twonky
        for char1 in ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"]:
            for char2 in ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"]:
                g = Game(chars=[char1, char2], bots=[Twonky, Twonky])
                assert g.characters == [char1, char2]


class TestBotGame:
    def test_bot_game_completes(self):
        from engine.game import Game
        from engine.robot import Twonky
        g = Game(randChars=True, bots=[Twonky, Twonky])
        winner = g.play()
        assert winner is not None
        assert g.victoryType in ["M", "D", "C", "T"]

    def test_bot_game_random_vs_focus(self):
        from engine.game import Game
        from engine.robot import RandomBot, FocusBot
        g = Game(randChars=True, bots=[RandomBot, FocusBot])
        winner = g.play()
        assert winner is not None

    def test_multiple_games_stable(self):
        from engine.game import Game
        from engine.robot import Twonky
        for _ in range(10):
            g = Game(randChars=True, bots=[Twonky, Twonky])
            winner = g.play()
            assert winner is not None
