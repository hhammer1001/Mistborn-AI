import uuid
import pickle
from engine.game import Game
from engine.robot import Twonky, RandomBot, FocusBot, HammerBot
from server.web_player import WebPlayer
from server.prompts import PromptNeeded


BOT_TYPES = {
    "twonky": Twonky,
    "random": RandomBot,
    "focus": FocusBot,
    "hammer": HammerBot,
}

CHARACTERS = ["Kelsier", "Shan", "Vin", "Marsh", "Prodigy"]


class LoggingBot:
    """Wraps a bot class to capture action descriptions during playTurn."""

    def __init__(self, bot, session):
        self.bot = bot
        self.session = session

    def __getattr__(self, name):
        return getattr(self.bot, name)

    def playTurn(self, game):
        original_perform = self.bot.performAction
        bot_turn = game.turncount

        def logging_perform(action, game):
            desc = self.bot.serialize_action(action, game).get("description", str(action))
            self.session._bot_log.append({"turn": bot_turn, "text": desc})
            return original_perform(action, game)

        self.bot.performAction = logging_perform
        try:
            self.bot.playTurn(game)
        finally:
            self.bot.performAction = original_perform


class GameSession:
    """Manages a single game instance and its turn-by-turn state for the server."""

    def __init__(self, player_name="Player", character="Kelsier",
                 opponent_type="twonky", opponent_character="Shan"):
        self.id = str(uuid.uuid4())
        self.player_name = player_name
        self.character = character
        self.opponent_type = opponent_type
        self.opponent_character = opponent_character
        self._bot_log = []
        self._pending_prompt = None
        self._pending_action_index = None
        self._accumulated_responses = []
        self._save_state = None

        bot_class = BOT_TYPES.get(opponent_type, Twonky)
        self.game = Game(
            names=[player_name, f"{opponent_type.title()} Bot"],
            chars=[character, opponent_character],
            players=[WebPlayer, bot_class],
        )
        self.human = self.game.players[0]
        self._real_bot = self.game.players[1]
        self.bot = LoggingBot(self._real_bot, self)
        self.phase = "actions"
        self._cached_raw = None

        # Start human's first turn
        self.game.turncount += 1
        self.human.resolve("T", "1")

    def _save_game_state(self):
        self._save_state = pickle.dumps(self.game)

    def _restore_game_state(self):
        if self._save_state:
            self.game = pickle.loads(self._save_state)
            self.human = self.game.players[0]
            self._real_bot = self.game.players[1]
            self.bot = LoggingBot(self._real_bot, self)

    def get_state(self):
        state = self.game.to_dict(perspective=0)
        state["sessionId"] = self.id
        state["phase"] = self.phase

        if self.phase == "actions":
            serialized, raw = self.human.serialize_actions(self.game)
            self._cached_raw = raw
            state["availableActions"] = serialized
        else:
            state["availableActions"] = []

        if self._pending_prompt:
            state["prompt"] = self._pending_prompt.to_dict()

        state["botLog"] = self._bot_log
        self._bot_log = []

        return state

    def play_action(self, action_index):
        """Human player selects an action by index, with save/restore for prompt support."""
        if self.phase != "actions":
            return {"error": f"Cannot play action in phase: {self.phase}"}

        if self._cached_raw is None:
            self.get_state()

        if action_index < 0 or action_index >= len(self._cached_raw):
            return {"error": f"Invalid action index: {action_index}"}

        # Save state BEFORE attempting the action
        self._save_game_state()
        self._pending_action_index = action_index
        self._accumulated_responses = []

        action = self._cached_raw[action_index]
        self.human.clear_prompt_responses()

        try:
            self.human.performAction(action, self.game)
        except PromptNeeded as p:
            self._pending_prompt = p
            self.phase = "awaiting_prompt"
            # Restore to pre-action state
            self._restore_game_state()
            # Re-cache raw actions from restored state
            _, raw = self.human.serialize_actions(self.game)
            self._cached_raw = raw
            return self.get_state()

        # Action succeeded with no prompts — discard saved state
        self._pending_prompt = None
        self._save_state = None

        if action[0] == 0:
            self._end_human_turn()
        else:
            self._cached_raw = None

        return self.get_state()

    def respond_to_prompt(self, prompt_type: str, value):
        if self.phase != "awaiting_prompt" or not self._pending_prompt:
            return {"error": "No pending prompt"}

        if prompt_type != self._pending_prompt.prompt_type:
            return {"error": f"Expected prompt type {self._pending_prompt.prompt_type}, got {prompt_type}"}

        self._accumulated_responses.append((prompt_type, value))
        self._pending_prompt = None
        self.phase = "actions"

        # Restore pre-action state and replay with all accumulated responses
        self._restore_game_state()
        _, raw = self.human.serialize_actions(self.game)
        self._cached_raw = raw

        action = self._cached_raw[self._pending_action_index]
        self.human.clear_prompt_responses()
        for ptype, pvalue in self._accumulated_responses:
            self.human.set_prompt_response(ptype, pvalue)

        try:
            self.human.performAction(action, self.game)
        except PromptNeeded as p:
            # Another prompt needed
            self._pending_prompt = p
            self.phase = "awaiting_prompt"
            # Restore again for next replay
            self._restore_game_state()
            _, raw = self.human.serialize_actions(self.game)
            self._cached_raw = raw
            return self.get_state()

        # Completed
        self._pending_prompt = None
        self._save_state = None
        self._accumulated_responses = []

        if action[0] == 0:
            self._end_human_turn()
        else:
            self._cached_raw = None

        return self.get_state()

    def _end_human_turn(self):
        self.human.assignDamage(self.game)
        self.game.attack(self.human)
        self.human.curDamage = self.human.pDamage

        if self.game.winner:
            self.phase = "game_over"
            return

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

        self.game.turncount += 1
        self.human.resolve("T", "1")
        self.phase = "actions"
        self._cached_raw = None


class SessionManager:
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
