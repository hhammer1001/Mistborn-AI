import pytest
import json
from engine.game import Game
from engine.robot import Twonky, RandomBot
from engine.card import Action, Ally, Funding


@pytest.fixture
def bot_game():
    g = Game(randChars=True, bots=[Twonky, Twonky])
    return g


@pytest.fixture
def mid_game():
    """A game that has been played to completion, so cards have been used."""
    g = Game(randChars=True, bots=[Twonky, Twonky])
    g.play()
    return g


class TestCardSerialization:
    def test_card_has_id(self, bot_game):
        card = bot_game.market.hand[0]
        d = card.to_dict()
        assert "id" in d
        assert isinstance(d["id"], int)

    def test_card_ids_unique(self, bot_game):
        all_cards = bot_game.market.hand + bot_game.market.cards
        for p in bot_game.players:
            all_cards += p.deck.hand + p.deck.cards + p.deck.discard
        ids = [c.to_dict()["id"] for c in all_cards]
        assert len(ids) == len(set(ids))

    def test_action_card_to_dict(self, bot_game):
        actions = [c for c in bot_game.market.hand + bot_game.market.cards if isinstance(c, Action)]
        assert len(actions) > 0
        d = actions[0].to_dict()
        assert d["type"] == "action"
        assert "capacity" in d
        assert "metalUsed" in d
        assert "burned" in d
        assert "abilities" in d
        assert isinstance(d["abilities"], list)

    def test_ally_card_to_dict(self, bot_game):
        allies = [c for c in bot_game.market.hand + bot_game.market.cards if isinstance(c, Ally)]
        if not allies:
            pytest.skip("No allies in market")
        d = allies[0].to_dict()
        assert d["type"] == "ally"
        assert "health" in d
        assert "defender" in d
        assert "available1" in d

    def test_funding_card_to_dict(self, bot_game):
        fundings = []
        for p in bot_game.players:
            fundings += [c for c in p.deck.hand + p.deck.cards if isinstance(c, Funding)]
        assert len(fundings) > 0
        d = fundings[0].to_dict()
        assert d["type"] == "funding"

    def test_card_metal_name(self, bot_game):
        card = bot_game.market.hand[0]
        d = card.to_dict()
        assert "metalName" in d
        assert d["metalName"] in ["pewter", "tin", "bronze", "copper", "zinc", "brass", "iron", "steel", "atium"]

    def test_card_to_dict_is_json_serializable(self, bot_game):
        for card in bot_game.market.hand:
            json.dumps(card.to_dict())


class TestMissionSerialization:
    def test_mission_to_dict(self, bot_game):
        m = bot_game.missions[0]
        d = m.to_dict()
        assert "name" in d
        assert "playerRanks" in d
        assert "tiers" in d
        assert "maxRank" in d
        assert len(d["playerRanks"]) == 2

    def test_mission_tiers_structure(self, bot_game):
        d = bot_game.missions[0].to_dict()
        for tier in d["tiers"]:
            assert "threshold" in tier
            assert "reward" in tier
            assert "rewardAmount" in tier
            assert "firstReward" in tier
            assert "firstRewardAmount" in tier

    def test_mission_to_dict_is_json_serializable(self, bot_game):
        for m in bot_game.missions:
            json.dumps(m.to_dict())


class TestPlayerSerialization:
    def test_player_to_dict_keys(self, bot_game):
        d = bot_game.players[0].to_dict()
        required_keys = [
            "name", "character", "turnOrder", "alive", "health",
            "damage", "money", "mission", "boxings",
            "hand", "handSize", "deckSize", "discardSize",
            "allies", "metalTokens", "metalAvailable", "metalBurned",
            "burns", "atium", "training", "maxHandSize",
            "charAbility1", "charAbility2", "charAbility3",
        ]
        for key in required_keys:
            assert key in d, f"Missing key: {key}"

    def test_player_hand_contains_cards(self, bot_game):
        d = bot_game.players[0].to_dict()
        assert len(d["hand"]) > 0
        for card in d["hand"]:
            assert "id" in card
            assert "name" in card
            assert "type" in card

    def test_player_hand_hidden_for_opponent(self, bot_game):
        d = bot_game.players[0].to_dict(reveal_hand=False)
        assert d["hand"] == []
        assert d["handSize"] > 0

    def test_player_to_dict_is_json_serializable(self, bot_game):
        for p in bot_game.players:
            json.dumps(p.to_dict())


class TestGameSerialization:
    def test_game_to_dict_structure(self, bot_game):
        d = bot_game.to_dict()
        assert "turnCount" in d
        assert "winner" in d
        assert "victoryType" in d
        assert "metalCodes" in d
        assert "market" in d
        assert "missions" in d
        assert "players" in d

    def test_game_market_structure(self, bot_game):
        d = bot_game.to_dict()
        market = d["market"]
        assert "hand" in market
        assert "deckSize" in market
        assert "discardSize" in market
        assert len(market["hand"]) == 6

    def test_game_to_dict_perspective_hides_opponent(self, bot_game):
        d = bot_game.to_dict(perspective=0)
        assert len(d["players"][0]["hand"]) > 0
        assert d["players"][1]["hand"] == []

    def test_game_to_dict_no_perspective_shows_all(self, bot_game):
        d = bot_game.to_dict()
        assert len(d["players"][0]["hand"]) > 0
        assert len(d["players"][1]["hand"]) > 0

    def test_game_to_dict_is_json_serializable(self, bot_game):
        json.dumps(bot_game.to_dict())

    def test_finished_game_has_winner(self, mid_game):
        d = mid_game.to_dict()
        assert d["winner"] is not None
        assert d["victoryType"] in ["M", "D", "C", "T"]

    def test_game_to_dict_after_play(self, mid_game):
        d = mid_game.to_dict()
        assert d["turnCount"] > 0


class TestActionSerialization:
    def test_serialize_actions_returns_list(self, bot_game):
        player = bot_game.players[0]
        serialized, raw = player.serialize_actions(bot_game)
        assert len(serialized) == len(raw)
        assert len(serialized) > 0

    def test_action_has_required_fields(self, bot_game):
        player = bot_game.players[0]
        serialized, _ = player.serialize_actions(bot_game)
        for action in serialized:
            assert "code" in action
            assert "index" in action
            assert "description" in action
            assert isinstance(action["description"], str)

    def test_end_action_always_present(self, bot_game):
        player = bot_game.players[0]
        serialized, _ = player.serialize_actions(bot_game)
        end_actions = [a for a in serialized if a["code"] == 0]
        assert len(end_actions) == 1
        assert end_actions[0]["description"] == "End actions (move to damage phase)"

    def test_actions_are_json_serializable(self, bot_game):
        player = bot_game.players[0]
        serialized, _ = player.serialize_actions(bot_game)
        json.dumps(serialized)

    def test_action_indices_sequential(self, bot_game):
        player = bot_game.players[0]
        serialized, _ = player.serialize_actions(bot_game)
        indices = [a["index"] for a in serialized]
        assert indices == list(range(len(serialized)))

    def test_buy_actions_have_card_id(self, bot_game):
        player = bot_game.players[0]
        # Give player money to enable buy actions
        player.curMoney = 20
        serialized, _ = player.serialize_actions(bot_game)
        buy_actions = [a for a in serialized if a["code"] == 6]
        assert len(buy_actions) > 0
        for action in buy_actions:
            assert "cardId" in action
