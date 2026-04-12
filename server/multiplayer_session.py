"""
Multiplayer game session for online play.

Designed to be stateless per-request: loaded from pickle, processes one action,
saved back. All state lives in the serialized pickle blob stored in InstantDB.
"""

import pickle
import base64
from engine.game import Game
from engine.card import Action
from server.web_player import WebPlayer
from server.prompts import PromptNeeded


EFFECT_NAMES = {
    "D": "damage", "M": "money", "H": "heal", "C": "draw", "E": "eliminate",
    "Mi": "mission", "T": "train", "K": "kill ally", "R": "refresh",
    "B": "burn", "A": "atium", "Pc": "+hand size", "Pd": "+perm damage",
    "Pm": "+perm money",
}


def _snapshot(player):
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
    parts = []
    diffs = [
        ("damage", "damage"), ("money", "money"), ("health", "heal"),
        ("mission", "mission"), ("training", "training"), ("atium", "atium"),
        ("burns", "burns"), ("handSize", "+hand size"),
        ("pDamage", "+perm damage"), ("pMoney", "+perm money"),
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


class MultiplayerGameSession:
    """Manages a multiplayer game between two human players."""

    def __init__(self, p0_name, p0_char, p1_name, p1_char):
        self.game = Game(
            names=[p0_name, p1_name],
            chars=[p0_char, p1_char],
            players=[WebPlayer, WebPlayer],
        )
        self.players = self.game.players
        self.active_player = 0
        self.phase = "actions"

        # Prompt replay state
        self._pending_prompt = None
        self._pending_action_index = None
        self._accumulated_responses = []
        self._save_state = None

        # Action cache (transient, recomputed each request)
        self._cached_raw = None

        # Per-player action logs (cumulative)
        self._log = [[], []]

        # Track defender HP at start of attacker's turn (for cloud defense)
        self._defender_hp_at_turn_start = None
        # Store cloud damage amount
        self._cloud_damage = 0

        # Player 0 goes first
        self.game.turncount = 1
        self._resolve_training(0)

    # ── Serialization ──

    def to_pickle_b64(self) -> str:
        """Serialize the full session to a base64 string for storage."""
        # Clear transient state
        self._cached_raw = None
        return base64.b64encode(pickle.dumps(self)).decode("ascii")

    @classmethod
    def from_pickle_b64(cls, data: str) -> "MultiplayerGameSession":
        """Restore a session from a base64 pickle string."""
        return pickle.loads(base64.b64decode(data))

    # ── State for clients ──

    def get_state(self, perspective: int) -> dict:
        """Get the game state visible to the given player."""
        state = self.game.to_dict(perspective=perspective)
        state["phase"] = self.phase
        state["activePlayer"] = self.active_player
        state["myPlayerIndex"] = perspective
        state["isMyTurn"] = (self.active_player == perspective)
        state["turnCount"] = self.game.turncount

        # Determine if this player won
        if self.game.winner:
            winner_index = self.game.winner.turnOrder if hasattr(self.game.winner, 'turnOrder') else -1
            state["isWinner"] = (winner_index == perspective)
        else:
            state["isWinner"] = False

        # Available actions only for active player in actions phase
        if self.phase == "actions" and self.active_player == perspective:
            serialized, raw = self.players[perspective].serialize_actions(self.game)
            self._cached_raw = raw
            state["availableActions"] = serialized
        else:
            state["availableActions"] = []

        if self.phase == "damage" and self.active_player == perspective:
            state["damageTargets"] = self._get_damage_targets(perspective)

        if self.phase == "sense_defense" and self.active_player == perspective:
            p = self.players[perspective]
            sense_cards = [
                {"cardId": c.id, "name": c.name, "amount": int(c.data[10])}
                for c in p.deck.hand
                if isinstance(c, Action) and c.data[9] == "sense"
            ]
            state["senseCards"] = sense_cards

        if self.phase == "cloud_defense" and self.active_player == perspective:
            p = self.players[perspective]
            cloud_cards = [
                {"cardId": c.id, "name": c.name, "reduction": int(c.data[10])}
                for c in p.deck.hand
                if isinstance(c, Action) and c.data[9] == "cloudP"
            ]
            state["cloudCards"] = cloud_cards
            state["incomingDamage"] = self._cloud_damage

        if self._pending_prompt and self.active_player == perspective:
            state["prompt"] = self._pending_prompt.to_dict()

        # Logs: player sees their own log as "playerLog", opponent's as "botLog"
        state["playerLog"] = self._log[perspective]
        state["botLog"] = self._log[1 - perspective]

        return state

    def get_both_states(self) -> tuple[dict, dict]:
        """Return (p0_state, p1_state) for writing to InstantDB."""
        return self.get_state(0), self.get_state(1)

    # ── Validation ──

    def _validate_turn(self, player_index: int, allowed_phase: str):
        if player_index != self.active_player:
            raise ValueError("Not your turn")
        if self.phase != allowed_phase:
            raise ValueError(f"Cannot perform this in phase: {self.phase}")

    # ── Internal helpers ──

    def _active(self):
        return self.players[self.active_player]

    def _opponent(self):
        return self.players[1 - self.active_player]

    def _get_damage_targets(self, player_index: int):
        attacker = self.players[player_index]
        targets, opp = self.game.validTargets(attacker)
        return [
            {"index": i, "name": t.name, "health": t.health, "cardId": t.id}
            for i, t in enumerate(targets)
        ]

    def _action_source_name(self, action, player_index: int):
        p = self.players[player_index]
        code = action[0]
        if code == 2:
            return f"{action[1].name} (burn)"
        if code == 4:
            return action[1].name
        if code == 5:
            names = self.game.metalCodes
            return f"Burn {names[action[1]]}" if action[1] < len(names) else "Burn metal"
        if code == 8:
            return f"{action[1].name} ability 1"
        if code == 9:
            return f"{action[1].name} ability 2"
        if code == 10:
            return f"{p.character} ability I"
        if code == 11:
            return f"{p.character} ability III"
        if code == 6:
            return f"Bought {action[1].name} for {action[1].cost}"
        if code == 7:
            return f"Buy+eliminate {action[1].name}"
        if code == 13:
            return f"Bought {action[1].name} for {action[1].cost} ({action[2]} boxings)"
        if code == 14:
            return f"Buy+eliminate {action[1].name} ({action[2]} boxings)"
        if code == 1:
            return f"Mission {action[1].name}"
        return None

    def _save_game_state(self):
        self._save_state = pickle.dumps(self.game)

    def _restore_game_state(self):
        if self._save_state:
            self.game = pickle.loads(self._save_state)
            self.players = self.game.players

    def _log_action(self, player_index: int, action, snap_before, snap_after):
        """Log the effects of an action to the acting player's log."""
        effects = _diff_to_text(snap_before, snap_after)
        source = self._action_source_name(action, player_index)
        turn = self.game.turncount

        if source:
            if action[0] in (6, 13):
                self._log[player_index].append({"turn": turn, "text": source})
            elif action[0] in (7, 14):
                effects = [e for e in effects if "money" not in e]
                text = f"{source}: {', '.join(effects)}" if effects else source
                self._log[player_index].append({"turn": turn, "text": text})
            elif action[0] == 1:
                effects = [e for e in effects if e != "-1 mission"]
                if effects:
                    self._log[player_index].append({
                        "turn": turn, "text": f"{source}: {', '.join(effects)}"
                    })
            elif effects:
                self._log[player_index].append({
                    "turn": turn, "text": f"{source}: {', '.join(effects)}"
                })

    def _resolve_training(self, player_index: int):
        p = self.players[player_index]
        snap = _snapshot(p)
        p.resolve("T", "1")
        effects = _diff_to_text(snap, _snapshot(p))
        effects = [e for e in effects if e != "+1 training"]
        if effects:
            self._log[player_index].append({
                "turn": self.game.turncount,
                "text": f"Training reward (level {p.training}): {', '.join(effects)}",
            })

    # ── Action methods ──

    def play_action(self, player_index: int, action_index: int):
        """Active player selects an action by index."""
        self._validate_turn(player_index, "actions")
        pi = player_index
        p = self.players[pi]

        if self._cached_raw is None:
            self.get_state(pi)

        if action_index < 0 or action_index >= len(self._cached_raw):
            return {"error": f"Invalid action index: {action_index}"}

        # Save state for prompt replay
        self._save_game_state()
        self._pending_action_index = action_index
        self._accumulated_responses = []

        action = self._cached_raw[action_index]
        p.clear_prompt_responses()

        # Action 0 = end actions
        if action[0] == 0:
            p.curBoxings += p.curMoney // 2
            p.curMoney = p.pMoney
            p.curMission = 0
            p.metalTokens = list(map(p.resetToken, p.metalTokens))
            p.metalTokens[8] = 0
            p.metalAvailable = [0] * 9
            p.metalBurned = [0] * 9
            p.charAbility1 = True
            p.charAbility2 = True
            p.charAbility3 = True

            # Record opponent HP for cloud defense check later
            opp = self._opponent()
            self._defender_hp_at_turn_start = opp.curHealth

            if p.curDamage > 0:
                self.phase = "damage"
            else:
                self._execute_attack_and_transition(pi)

            self._cached_raw = None
            self._pending_prompt = None
            self._save_state = None
            return None  # success

        # Normal action
        snap_before = _snapshot(p)
        mission_before = p.curMission

        try:
            p.performAction(action, self.game)
        except PromptNeeded as prompt:
            self._pending_prompt = prompt
            self.phase = "awaiting_prompt"
            self._restore_game_state()
            _, raw = p.serialize_actions(self.game)
            self._cached_raw = raw
            return None

        self._pending_prompt = None
        self._save_state = None

        snap_after = _snapshot(p)
        self._log_action(pi, action, snap_before, snap_after)

        # Log sense block on mission advance
        if action[0] == 1:
            mission_spent = mission_before - p.curMission
            if mission_spent != 1:
                oi = 1 - pi
                self._log[oi].append({
                    "turn": self.game.turncount,
                    "text": f"Opponent used Sense to block mission advance! (-{mission_spent} mission)",
                })

        if self.game.winner:
            self.phase = "game_over"

        self._cached_raw = None
        return None

    def respond_to_prompt(self, player_index: int, prompt_type: str, value):
        """Active player responds to a mid-action prompt."""
        self._validate_turn(player_index, "awaiting_prompt")
        pi = player_index
        p = self.players[pi]

        if not self._pending_prompt:
            return {"error": "No pending prompt"}
        if prompt_type != self._pending_prompt.prompt_type:
            return {"error": f"Expected {self._pending_prompt.prompt_type}, got {prompt_type}"}

        self._accumulated_responses.append((prompt_type, value))
        self._pending_prompt = None
        self.phase = "actions"

        # Restore and replay
        self._restore_game_state()
        _, raw = self.players[pi].serialize_actions(self.game)
        self._cached_raw = raw

        action = self._cached_raw[self._pending_action_index]
        self.players[pi].clear_prompt_responses()
        for ptype, pvalue in self._accumulated_responses:
            self.players[pi].set_prompt_response(ptype, pvalue)

        try:
            self.players[pi].performAction(action, self.game)
        except PromptNeeded as prompt:
            self._pending_prompt = prompt
            self.phase = "awaiting_prompt"
            self._restore_game_state()
            _, raw = self.players[pi].serialize_actions(self.game)
            self._cached_raw = raw
            return None

        self._pending_prompt = None
        self._save_state = None
        self._accumulated_responses = []
        self._cached_raw = None

        if self.game.winner:
            self.phase = "game_over"

        return None

    def assign_damage(self, player_index: int, target_index: int):
        """Active player picks a target ally to kill, or -1 to finalize."""
        self._validate_turn(player_index, "damage")
        pi = player_index
        p = self.players[pi]

        if target_index == -1:
            self._execute_attack_and_transition(pi)
            return None

        targets, opp = self.game.validTargets(p)
        if target_index < 0 or target_index >= len(targets):
            return {"error": f"Invalid target index: {target_index}"}

        target = targets[target_index]
        p.curDamage -= target.health
        opp.killAlly(target)

        self._log[pi].append({
            "turn": self.game.turncount,
            "text": f"Killed {opp.name}'s {target.name}",
        })
        self._log[1 - pi].append({
            "turn": self.game.turncount,
            "text": f"Opponent killed your {target.name}",
        })

        # Check if more targets available
        new_targets, _ = self.game.validTargets(p)
        if not new_targets:
            self._execute_attack_and_transition(pi)

        return None

    def _execute_attack_and_transition(self, attacker_index: int):
        """Execute the attack, then check cloud → cleanup → sense → swap turns."""
        pi = attacker_index
        oi = 1 - pi
        p = self.players[pi]
        opp = self.players[oi]

        opp_hp_before = self._defender_hp_at_turn_start or opp.curHealth
        self.game.attack(p)
        p.curDamage = p.pDamage
        opp_hp_after = opp.curHealth
        hp_lost = opp_hp_before - opp_hp_after

        # Log damage dealt
        if hp_lost > 0:
            self._log[pi].append({
                "turn": self.game.turncount,
                "text": f"Dealt {hp_lost} damage to {opp.name}",
            })

        # Check cloud defense for opponent
        cloud_cards = [
            c for c in opp.deck.hand
            if isinstance(c, Action) and c.data[9] == "cloudP"
        ]
        if hp_lost > 0 and cloud_cards:
            self._cloud_damage = hp_lost
            self._log[oi].append({
                "turn": self.game.turncount,
                "text": f"Incoming: {hp_lost} damage",
            })
            self.phase = "cloud_defense"
            self.active_player = oi
            return

        if self.game.winner:
            self.phase = "game_over"
            return

        self._post_attack_cleanup(pi)

    def _post_attack_cleanup(self, attacker_index: int):
        """After attack (and cloud if any), cleanup attacker's turn and check sense."""
        pi = attacker_index
        oi = 1 - pi
        p = self.players[pi]

        # Draw new hand for the attacker
        p.deck.cleanUp(p)
        for ally in p.allies:
            ally.reset()

        if self.game.winner:
            self.phase = "game_over"
            return

        # Check if attacker has sense cards in their new hand
        sense_cards = [
            c for c in p.deck.hand
            if isinstance(c, Action) and c.data[9] == "sense"
        ]
        if sense_cards:
            self.phase = "sense_defense"
            self.active_player = pi  # attacker decides sense
            # Store who we'll swap to after sense
            self._next_player_after_sense = oi
            return

        p._sense_flag = False
        self._start_next_turn(oi)

    def resolve_sense(self, player_index: int, use: bool):
        """Player decides whether to activate sense for the opponent's upcoming turn."""
        self._validate_turn(player_index, "sense_defense")
        self.players[player_index]._sense_flag = use

        # Determine who goes next
        next_player = getattr(self, "_next_player_after_sense", 1 - player_index)
        self._start_next_turn(next_player)
        return None

    def resolve_cloud(self, player_index: int, card_id: int):
        """Defender uses a cloud card to block damage, or -1 to skip."""
        self._validate_turn(player_index, "cloud_defense")
        pi = player_index
        p = self.players[pi]
        attacker_index = 1 - pi

        if card_id == -1:
            # Skip cloud defense
            if self.game.winner:
                self.phase = "game_over"
            else:
                self._post_attack_cleanup(attacker_index)
            return None

        # Find and use the cloud card
        card = None
        for c in p.deck.hand:
            if c.id == card_id and c.data[9] == "cloudP":
                card = c
                break
        if not card:
            return {"error": "Cloud card not found in hand"}

        reduction = int(card.data[10])
        p.curHealth = min(p.curHealth + reduction, 40)
        p.deck.hand.remove(card)
        p.deck.discard.append(card)

        self._log[pi].append({
            "turn": self.game.turncount,
            "text": f"Your {card.name} blocked {reduction} damage",
        })
        self._log[attacker_index].append({
            "turn": self.game.turncount,
            "text": f"Opponent's {card.name} blocked {reduction} damage",
        })

        # Un-die if cloud saved us
        if p.curHealth > 0:
            p.alive = True
            if self.game.victoryType == 'D' and self.game.winner != p:
                self.game.winner = None
                self.game.victoryType = None

        # Check for more cloud cards
        remaining = [
            c for c in p.deck.hand
            if isinstance(c, Action) and c.data[9] == "cloudP"
        ]
        if not remaining:
            if self.game.winner:
                self.phase = "game_over"
            else:
                self._post_attack_cleanup(attacker_index)

        return None

    def _start_next_turn(self, next_player_index: int):
        """Start the next player's turn."""
        self.active_player = next_player_index
        self.game.turncount += 1

        if self.game.turncount > 1000:
            self.game.victoryType = 'T'
            self.game.winner = self.game.players[0]  # player 0 wins on timeout
            self.phase = "game_over"
            return

        self._resolve_training(next_player_index)
        self.phase = "actions"
        self._cached_raw = None
        self._defender_hp_at_turn_start = None

    def forfeit(self, player_index: int):
        """A player forfeits the game."""
        winner_index = 1 - player_index
        self.game.winner = self.players[winner_index]  # must be Player object, not string
        self.game.victoryType = "F"
        self.phase = "game_over"
