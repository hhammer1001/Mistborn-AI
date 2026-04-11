"""
WebPlayer: A Player subclass for web-based play.

The session manager drives the turn loop instead of playTurn(), so selectAction
is never called. The *In methods either use saved prompt responses or raise
PromptNeeded to request user input from the frontend.

For looped prompts (eliminate, pull), responses are stored as a list and
consumed one at a time on each replay.
"""

from engine.player import Player
from engine.card import Funding, Action, Ally
from server.prompts import PromptNeeded


class WebPlayer(Player):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._prompt_responses = {}   # prompt_type -> value (single-use)
        self._prompt_queues = {}      # prompt_type -> [values] (multi-use, for loops)
        self._sense_flag = False      # set per-turn by sense_defense phase

    def set_prompt_response(self, prompt_type: str, value):
        """Set a response for a pending prompt."""
        if prompt_type in self._prompt_queues:
            self._prompt_queues[prompt_type].append(value)
        else:
            self._prompt_queues[prompt_type] = [value]
        self._prompt_responses[prompt_type] = value

    def clear_prompt_responses(self):
        self._prompt_responses = {}
        self._prompt_queues = {}

    def _get_response(self, prompt_type: str):
        """Get and consume a single prompt response, or return None."""
        return self._prompt_responses.pop(prompt_type, None)

    def _get_queue_response(self, prompt_type: str):
        """Get and consume the next response from a queue, or return None."""
        q = self._prompt_queues.get(prompt_type)
        if q and len(q) > 0:
            return q.pop(0)
        return None

    def selectAction(self, actions, game):
        raise RuntimeError("WebPlayer.selectAction should not be called directly")

    def assignDamageIn(self, targets):
        if not targets:
            return -1
        best = max(range(len(targets)), key=lambda i: targets[i].health)
        return best

    def senseCheckIn(self, card):
        return self._sense_flag

    def killEnemyAllyIn(self, allies):
        if not allies:
            return -1
        return max(range(len(allies)), key=lambda i: allies[i].health)

    def cloudAlly(self, card, ally):
        return False

    def eliminateIn(self):
        resp = self._get_queue_response("eliminate")
        if resp is not None:
            return int(resp)
        h = len(self.deck.hand)
        d = len(self.deck.discard)
        if h + d == 0:
            return -1
        options = []
        for i, c in enumerate(self.deck.hand):
            # Can't eliminate the card that's currently being played
            if self._active_card and c.id == self._active_card.id:
                continue
            options.append({"index": i, "name": c.name, "source": "hand"})
        for i, c in enumerate(self.deck.discard):
            options.append({"index": i + h, "name": c.name, "source": "discard"})
        if not options:
            return -1
        options.append({"index": -1, "name": "Skip", "source": "skip"})
        raise PromptNeeded("eliminate", options, "Choose a card to eliminate")

    def pullIn(self):
        resp = self._get_queue_response("pull")
        if resp is not None:
            return int(resp)
        if not self.deck.discard:
            return -1
        options = []
        for i, c in enumerate(self.deck.discard):
            options.append({"index": i, "name": c.name, "source": "discard"})
        options.append({"index": -1, "name": "Skip", "source": "skip"})
        raise PromptNeeded("pull", options, "Choose a card to pull to top of deck")

    def subdueIn(self, choices):
        if not choices:
            return -1
        resp = self._get_response("subdue")
        if resp is not None:
            return int(resp)
        options = []
        for i, c in enumerate(choices):
            options.append({"index": i, "name": c.name, "cost": c.cost})
        options.append({"index": -1, "name": "Skip", "source": "skip"})
        raise PromptNeeded("subdue", options, "Choose a market card to gain (cost ≤ 5)")

    def soarIn(self, choices):
        if not choices:
            return -1
        resp = self._get_response("soar")
        if resp is not None:
            return int(resp)
        options = []
        for i, c in enumerate(choices):
            options.append({"index": i, "name": c.name})
        options.append({"index": -1, "name": "Skip", "source": "skip"})
        raise PromptNeeded("soar", options, "Choose an eliminated card to gain")

    def confrontationIn(self, choices):
        if not choices:
            return -1
        resp = self._get_response("confrontation")
        if resp is not None:
            return int(resp)
        options = []
        for i, c in enumerate(choices):
            options.append({"index": i, "name": c.name})
        options.append({"index": -1, "name": "Skip", "source": "skip"})
        raise PromptNeeded("confrontation", options, "Choose an action card to play its top ability")

    def informantIn(self, card):
        resp = self._get_response("informant")
        if resp is not None:
            return bool(resp)
        raise PromptNeeded("informant",
            [{"index": 1, "name": f"Eliminate {card.name}"}, {"index": 0, "name": "Put it back"}],
            f"Top of deck: {card.name}")

    def keeperIn(self, choices):
        resp = self._get_response("keeper")
        if resp is not None:
            return int(resp)
        options = []
        for i, c in enumerate(choices):
            options.append({"index": i, "name": c.name})
        raise PromptNeeded("keeper", options, "Choose a card to set aside (draw next turn)")

    def chooseIn(self, options):
        resp = self._get_response("choose")
        if resp is not None:
            return int(resp)
        readable = []
        for i in range(0, len(options), 2):
            readable.append({"index": i // 2, "effect": options[i], "amount": options[i + 1]})
        raise PromptNeeded("choose", readable, "Choose an effect")

    def refreshIn(self):
        resp = self._get_response("refresh")
        if resp is not None:
            return int(resp)
        flared = [i for i, val in enumerate(self.metalTokens) if val in [2, 4]]
        if len(flared) <= 1:
            return flared[0] if flared else 0
        raise PromptNeeded("refresh",
            [{"index": i, "metal": self.game.metalCodes[i]} for i in flared],
            "Choose a metal to refresh")

    def pushIn(self):
        resp = self._get_response("push")
        if resp is not None:
            return int(resp)
        market = self.game.market.hand
        if not market:
            return -1
        options = []
        for i, c in enumerate(market):
            options.append({"index": i, "name": c.name, "cost": c.cost})
        options.append({"index": -1, "name": "Skip", "source": "skip"})
        raise PromptNeeded("push", options, "Choose a market card to eliminate")

    def riotIn(self, riotable):
        if len(riotable) <= 1:
            return riotable[0]
        resp = self._get_response("riot")
        if resp is not None:
            return riotable[int(resp)]
        options = []
        for i, ally in enumerate(riotable):
            options.append({"index": i, "name": ally.name})
        raise PromptNeeded("riot", options, "Choose an ally to activate")

    def seekIn(self, twice, seeker, choices):
        if not choices:
            return -1, -1

        # First selection
        resp1 = self._get_queue_response("seek")
        if resp1 is None:
            options = []
            for i, c in enumerate(choices):
                options.append({"index": i, "name": c.name, "cost": c.cost})
            options.append({"index": -1, "name": "Skip", "source": "skip"})
            if twice:
                ctx = "Pierce: Choose 1st action to use its top ability (pick 2)"
            elif seeker:
                ctx = "Seek: Choose an action to use and mark as sought"
            else:
                ctx = "Seek: Choose an action to use its top ability"
            raise PromptNeeded("seek", options, ctx)
        choice1 = int(resp1)

        if not twice or choice1 == -1:
            return choice1, -1

        # Second selection
        resp2 = self._get_queue_response("seek")
        if resp2 is None:
            options = []
            for i, c in enumerate(choices):
                if i != choice1:
                    options.append({"index": i, "name": c.name, "cost": c.cost})
            options.append({"index": -1, "name": "Skip", "source": "skip"})
            raise PromptNeeded("seek", options, "Choose a 2nd action to use (different from 1st)")
        choice2 = int(resp2)

        return choice1, choice2

    def cloudP(self, card):
        return False  # handled by cloud_defense phase after bot turn
