import uuid
import pickle
from engine.game import Game
from engine.card import Action, Ally
from engine.robot import Twonky, RandomBot, FocusBot, HammerBot
from server.web_player import WebPlayer
from server.prompts import PromptNeeded

EFFECT_NAMES = {
    "D": "damage", "M": "money", "H": "heal", "C": "draw", "E": "eliminate",
    "Mi": "mission", "T": "train", "K": "kill ally", "R": "refresh",
    "B": "burn", "A": "atium", "Pc": "+hand size", "Pd": "+perm damage",
    "Pm": "+perm money",
}


def _snapshot(player):
    """Capture player state for diff-based logging."""
    return {
        "damage": player.curDamage,
        "money": player.curMoney,
        "health": player.curHealth,
        "mission": player.curMission,
        "training": player.training,
        "atium": player.atium,
        "burns": player.burns,
        "handSize": player.handSize,
        "pDamage": player.pDamage,
        "pMoney": player.pMoney,
        "hand_count": len(player.deck.hand),
        "allies": [a.name for a in player.allies],
    }


def _diff_to_text(before, after):
    """Produce a list of human-readable effect strings from two snapshots."""
    parts = []
    diffs = [
        ("damage", "damage"),
        ("money", "money"),
        ("health", "heal"),
        ("mission", "mission"),
        ("training", "training"),
        ("atium", "atium"),
        ("burns", "burns"),
        ("handSize", "+hand size"),
        ("pDamage", "+perm damage"),
        ("pMoney", "+perm money"),
    ]
    for key, label in diffs:
        delta = after[key] - before[key]
        if delta > 0:
            parts.append(f"+{delta} {label}")
        elif delta < 0:
            parts.append(f"{delta} {label}")

    draw_delta = after["hand_count"] - before["hand_count"]
    if draw_delta > 0:
        parts.append(f"drew {draw_delta}")

    new_allies = [n for n in after["allies"] if n not in before["allies"]]
    for n in new_allies:
        parts.append(f"played {n}")

    return parts


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
        self._player_log = []
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
        self._resolve_training()

    def _save_game_state(self):
        self._save_state = pickle.dumps(self.game)

    def _restore_game_state(self):
        if self._save_state:
            self.game = pickle.loads(self._save_state)
            self.human = self.game.players[0]
            self._real_bot = self.game.players[1]
            self.bot = LoggingBot(self._real_bot, self)

    def _get_damage_targets(self):
        """Return serialized list of opponent allies the human can kill with current damage."""
        targets, opp = self.game.validTargets(self.human)
        return [
            {"index": i, "name": t.name, "health": t.health, "cardId": t.id}
            for i, t in enumerate(targets)
        ]

    def _action_source_name(self, action):
        """Return a human-readable source name for an action tuple."""
        code = action[0]
        if code == 2:  # burn card
            return f"{action[1].name} (burn)"
        if code == 4:  # use metal on card
            return action[1].name
        if code == 5:  # burn/flare metal token
            names = self.game.metalCodes
            return f"Burn {names[action[1]]}" if action[1] < len(names) else "Burn metal"
        if code == 8:  # ally ability 1
            return f"{action[1].name} ability 1"
        if code == 9:  # ally ability 2
            return f"{action[1].name} ability 2"
        if code == 10:  # character ability 1
            return f"{self.human.character} ability I"
        if code == 11:  # character ability 3
            return f"{self.human.character} ability III"
        if code == 6:  # buy
            return f"Bought {action[1].name} for {action[1].cost}"
        if code == 7:  # buy and eliminate
            return f"Buy+eliminate {action[1].name}"
        if code == 13:  # buy with boxings
            return f"Bought {action[1].name} for {action[1].cost} ({action[2]} boxings)"
        if code == 14:  # buy+eliminate with boxings
            return f"Buy+eliminate {action[1].name} ({action[2]} boxings)"
        if code == 1:  # advance mission
            return f"Mission {action[1].name}"
        return None

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

        if self.phase == "damage":
            state["damageTargets"] = self._get_damage_targets()

        if self.phase == "sense_defense":
            sense_cards = [{"cardId": c.id, "name": c.name, "amount": int(c.data[10])}
                           for c in self.human.deck.hand
                           if isinstance(c, Action) and c.data[9] == "sense"]
            state["senseCards"] = sense_cards

        if self.phase == "cloud_defense":
            cloud_cards = [{"cardId": c.id, "name": c.name, "reduction": int(c.data[10])}
                           for c in self.human.deck.hand
                           if isinstance(c, Action) and c.data[9] == "cloudP"]
            state["cloudCards"] = cloud_cards

        if self._pending_prompt:
            state["prompt"] = self._pending_prompt.to_dict()

        state["botLog"] = self._bot_log
        self._bot_log = []
        state["playerLog"] = self._player_log
        self._player_log = []

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

        # For action 0 (end actions), do pre-damage cleanup but defer
        # hand redraw until after the damage phase so the player can
        # still see their cards while assigning damage.
        if action[0] == 0:
            h = self.human
            h.curBoxings += h.curMoney // 2
            h.curMoney = h.pMoney
            h.curMission = 0
            h.metalTokens = list(map(h.resetToken, h.metalTokens))
            h.metalTokens[8] = 0
            h.metalAvailable = [0] * 9
            h.metalBurned = [0] * 9
            h.charAbility1 = True
            h.charAbility2 = True
            h.charAbility3 = True
            # deck.cleanUp and ally.reset are deferred to after damage phase
            if h.curDamage > 0:
                self.phase = "damage"
            else:
                self.game.attack(h)
                h.curDamage = h.pDamage
                self._cleanup_and_finish()
            self._cached_raw = None
            self._pending_prompt = None
            self._save_state = None
            return self.get_state()

        # Snapshot before action for effect logging
        snap_before = _snapshot(self.human)
        mission_before = self.human.curMission

        try:
            self.human.performAction(action, self.game)
        except PromptNeeded as p:
            self._pending_prompt = p
            self.phase = "awaiting_prompt"
            self._restore_game_state()
            _, raw = self.human.serialize_actions(self.game)
            self._cached_raw = raw
            return self.get_state()

        self._pending_prompt = None
        self._save_state = None

        # Log effects from this action
        snap_after = _snapshot(self.human)
        effects = _diff_to_text(snap_before, snap_after)

        source = self._action_source_name(action)
        if source:
            # For plain buys (6, 13), cost is in the source name — just log source
            if action[0] in (6, 13):
                self._player_log.append({
                    "turn": self.game.turncount,
                    "text": source,
                })
            # For buy+eliminate (7, 14), show the ability effects (filter out money)
            elif action[0] in (7, 14):
                effects = [e for e in effects if "money" not in e]
                if effects:
                    self._player_log.append({
                        "turn": self.game.turncount,
                        "text": f"{source}: {', '.join(effects)}",
                    })
                else:
                    self._player_log.append({
                        "turn": self.game.turncount,
                        "text": source,
                    })
            # For mission advance (1), filter out the -1 mission spend — only log tier rewards
            elif action[0] == 1:
                effects = [e for e in effects if e != "-1 mission"]
                if effects:
                    self._player_log.append({
                        "turn": self.game.turncount,
                        "text": f"{source}: {', '.join(effects)}",
                    })
            elif effects:
                self._player_log.append({
                    "turn": self.game.turncount,
                    "text": f"{source}: {', '.join(effects)}",
                })

        # Log sense check if mission advance was blocked
        if action[0] == 1:
            mission_spent = mission_before - self.human.curMission
            if mission_spent != 1:
                self._bot_log.append({
                    "turn": self.game.turncount,
                    "text": f"Opponent used Sense to block mission advance! (−{mission_spent} mission)",
                })

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
        self._cached_raw = None

        return self.get_state()

    def assign_damage(self, target_index):
        """Human picks a target ally to kill, or -1 to deal remaining damage to opponent."""
        if self.phase != "damage":
            return {"error": f"Cannot assign damage in phase: {self.phase}"}

        if target_index == -1:
            # Done assigning to allies — deal remaining damage to opponent
            self.game.attack(self.human)
            self.human.curDamage = self.human.pDamage
            self._cleanup_and_finish()
            return self.get_state()

        targets, opp = self.game.validTargets(self.human)
        if target_index < 0 or target_index >= len(targets):
            return {"error": f"Invalid target index: {target_index}"}

        target = targets[target_index]
        self.human.curDamage -= target.health
        opp.killAlly(target)

        # Check if more targets available
        new_targets, _ = self.game.validTargets(self.human)
        if not new_targets:
            # No more killable allies — deal remaining damage to opponent
            self.game.attack(self.human)
            self.human.curDamage = self.human.pDamage
            self._cleanup_and_finish()

        return self.get_state()

    def _cleanup_and_finish(self):
        """Draw new hand (deferred from end-of-actions) then finish turn."""
        self.human.deck.cleanUp(self.human)
        for ally in self.human.allies:
            ally.reset()
        self._finish_human_turn()

    def _finish_human_turn(self):
        """Complete the human turn — check sense, run bot, check cloud."""
        if self.game.winner:
            self.phase = "game_over"
            return

        self.game.turncount += 1
        if self.game.turncount > 1000:
            self.game.victoryType = 'T'
            self.game.winner = self.game.players[1]
            self.phase = "game_over"
            return

        # Check for sense defense before bot turn
        sense_cards = [c for c in self.human.deck.hand
                       if isinstance(c, Action) and c.data[9] == "sense"]
        if sense_cards:
            self.phase = "sense_defense"
            return

        self.human._sense_flag = False
        self._run_bot_turn()

    def resolve_sense(self, use):
        """Player decides whether to use sense card to block bot mission advances."""
        if self.phase != "sense_defense":
            return {"error": f"Cannot resolve sense in phase: {self.phase}"}
        self.human._sense_flag = use
        self._run_bot_turn()
        return self.get_state()

    def _run_bot_turn(self):
        """Execute the bot's turn, then check for cloud defense."""
        human_hp_before = self.human.curHealth
        human_allies_before = [a.name for a in self.human.allies]
        human_hand_before = set(c.id for c in self.human.deck.hand)

        self.bot.playTurn(self.game)

        bot_turn = self.game.turncount

        # Log ally kills
        killed = [n for n in human_allies_before
                  if n not in [a.name for a in self.human.allies]]
        for name in killed:
            self._bot_log.append({"turn": bot_turn, "text": f"Killed your {name}"})

        # Log sense card usage
        human_hand_after = set(c.id for c in self.human.deck.hand)
        used_ids = human_hand_before - human_hand_after
        for card in self.human.deck.discard:
            if card.id in used_ids and card.data[9] == "sense":
                self._bot_log.append({"turn": bot_turn,
                                      "text": f"Your {card.name} blocked a mission advance"})

        hp_lost = human_hp_before - self.human.curHealth

        # Check for cloud defense opportunity
        cloud_cards = [c for c in self.human.deck.hand
                       if isinstance(c, Action) and c.data[9] == "cloudP"]
        if hp_lost > 0 and cloud_cards:
            self._bot_log.append({"turn": bot_turn,
                                  "text": f"Incoming: {hp_lost} damage"})
            self.phase = "cloud_defense"
            return

        if hp_lost > 0:
            self._bot_log.append({"turn": bot_turn,
                                  "text": f"Dealt {hp_lost} damage to you"})

        if self.game.winner:
            self.phase = "game_over"
            return

        self._start_next_human_turn()

    def resolve_cloud(self, card_id):
        """Player picks a cloud card to block damage, or -1 to skip."""
        if self.phase != "cloud_defense":
            return {"error": f"Cannot resolve cloud in phase: {self.phase}"}

        if card_id == -1:
            if self.game.winner:
                self.phase = "game_over"
            else:
                self._start_next_human_turn()
            return self.get_state()

        # Find and use the cloud card
        card = None
        for c in self.human.deck.hand:
            if c.id == card_id and c.data[9] == "cloudP":
                card = c
                break
        if not card:
            return {"error": "Cloud card not found in hand"}

        reduction = int(card.data[10])
        self.human.curHealth = min(self.human.curHealth + reduction, 40)
        self.human.deck.hand.remove(card)
        self.human.deck.discard.append(card)

        self._bot_log.append({
            "turn": self.game.turncount,
            "text": f"Your {card.name} blocked {reduction} damage",
        })

        # Un-die if cloud saved us
        if self.human.curHealth > 0:
            self.human.alive = True
            if self.game.victoryType == 'D' and self.game.winner != self.human:
                self.game.winner = None
                self.game.victoryType = None

        # Check for more cloud cards
        remaining = [c for c in self.human.deck.hand
                     if isinstance(c, Action) and c.data[9] == "cloudP"]
        if not remaining:
            if self.game.winner:
                self.phase = "game_over"
            else:
                self._start_next_human_turn()

        return self.get_state()

    def _start_next_human_turn(self):
        self.game.turncount += 1
        self._resolve_training()
        self.phase = "actions"
        self._cached_raw = None

    def _resolve_training(self):
        """Advance training by 1 and log any rewards gained."""
        snap = _snapshot(self.human)
        self.human.resolve("T", "1")
        effects = _diff_to_text(snap, _snapshot(self.human))
        # Filter out the training +1 itself — that's implied
        effects = [e for e in effects if e != "+1 training"]
        if effects:
            self._player_log.append({
                "turn": self.game.turncount,
                "text": f"Training reward (level {self.human.training}): {', '.join(effects)}",
            })


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
