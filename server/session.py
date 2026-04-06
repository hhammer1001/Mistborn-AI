import uuid
from engine.game import Game
from engine.robot import Twonky, RandomBot, FocusBot, HammerBot
from server.web_player import WebPlayer


BOT_TYPES = {
    "twonky": Twonky,
    "random": RandomBot,
    "focus": FocusBot,
    "hammer": HammerBot,
}

CHARACTERS = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"]


class GameSession:
    """Manages a single game instance and its turn-by-turn state for the server."""

    def __init__(self, player_name="Player", character="Kelsier",
                 opponent_type="twonky", opponent_character="Shan"):
        self.id = str(uuid.uuid4())
        self.player_name = player_name
        self.character = character
        self.opponent_type = opponent_type
        self.opponent_character = opponent_character

        bot_class = BOT_TYPES.get(opponent_type, Twonky)
        self.game = Game(
            names=[player_name, f"{opponent_type.title()} Bot"],
            chars=[character, opponent_character],
            players=[WebPlayer, bot_class],
        )
        self.human = self.game.players[0]
        self.bot = self.game.players[1]
        self.phase = "actions"  # "actions", "game_over"
        self._cached_raw = None

        # Start human's first turn (training step)
        self.game.turncount += 1
        self.human.resolve("T", "1")

    def get_state(self):
        """Return full game state from human player's perspective."""
        state = self.game.to_dict(perspective=0)
        state["sessionId"] = self.id
        state["phase"] = self.phase

        if self.phase == "actions":
            serialized, raw = self.human.serialize_actions(self.game)
            self._cached_raw = raw
            state["availableActions"] = serialized
        else:
            state["availableActions"] = []

        return state

    def play_action(self, action_index):
        """Human player selects an action by index. Returns new game state."""
        if self.phase != "actions":
            return {"error": "Game is over"}

        if self._cached_raw is None:
            self.get_state()

        if action_index < 0 or action_index >= len(self._cached_raw):
            return {"error": f"Invalid action index: {action_index}"}

        action = self._cached_raw[action_index]
        self.human.performAction(action, self.game)

        # Action 0 = end actions phase
        if action[0] == 0:
            self._end_human_turn()
        else:
            self._cached_raw = None

        return self.get_state()

    def _end_human_turn(self):
        """Resolve damage, attack, then let bot play, then start next human turn."""
        # Human damage assignment + attack
        self.human.assignDamage(self.game)
        self.game.attack(self.human)
        self.human.curDamage = self.human.pDamage

        if self.game.winner:
            self.phase = "game_over"
            return

        # Bot turn
        self.game.turncount += 1
        if self.game.turncount > 1000:
            self.game.victoryType = 'T'
            self.game.winner = self.game.players[1]
            self.phase = "game_over"
            return

        self.bot.playTurn(self.game)

        if self.game.winner:
            self.phase = "game_over"
            return

        # Start next human turn
        self.game.turncount += 1
        self.human.resolve("T", "1")
        self.phase = "actions"
        self._cached_raw = None


class SessionManager:
    """Manages multiple game sessions."""

    def __init__(self):
        self.sessions: dict[str, GameSession] = {}

    def create(self, **kwargs) -> GameSession:
        session = GameSession(**kwargs)
        self.sessions[session.id] = session
        return session

    def get(self, session_id: str) -> GameSession | None:
        return self.sessions.get(session_id)

    def delete(self, session_id: str):
        self.sessions.pop(session_id, None)
