"""
WebPlayer: A Player subclass for web-based play.

The session manager drives the turn loop instead of playTurn(), so selectAction
is never called. The *In methods provide sensible auto-defaults for card effects
that would normally require console input (eliminate, pull, seek, etc.).

These can be replaced with interactive UI prompts in a future session.
"""

from engine.player import Player
from engine.card import Funding, Action, Ally


class WebPlayer(Player):

    def selectAction(self, actions, game):
        # Should never be called — session manages action selection
        raise RuntimeError("WebPlayer.selectAction should not be called directly; use session.play_action()")

    def assignDamageIn(self, targets):
        if not targets:
            return -1
        # Kill the highest-health target
        best = max(range(len(targets)), key=lambda i: targets[i].health)
        return best

    def senseCheckIn(self, card):
        return True

    def killEnemyAllyIn(self, allies):
        if not allies:
            return -1
        return max(range(len(allies)), key=lambda i: allies[i].health)

    def cloudAlly(self, card, ally):
        return False

    def eliminateIn(self):
        h = len(self.deck.hand)
        d = len(self.deck.discard)
        if h + d < 6:
            return -1
        # Eliminate funding first
        for i, c in enumerate(self.deck.hand):
            if isinstance(c, Funding):
                return i
        for i, c in enumerate(self.deck.discard):
            if isinstance(c, Funding):
                return i + h
        return -1

    def pullIn(self):
        if not self.deck.discard:
            return -1
        return 0

    def subdueIn(self, choices):
        if not choices:
            return -1
        return 0

    def soarIn(self, choices):
        if not choices:
            return -1
        return 0

    def confrontationIn(self, choices):
        if not choices:
            return -1
        return 0

    def informantIn(self, card):
        return isinstance(card, Funding)

    def keeperIn(self, choices):
        return 0

    def chooseIn(self, options):
        return 0

    def refreshIn(self):
        for i, val in enumerate(self.metalTokens):
            if val in [2, 4]:
                return i
        return 0

    def pushIn(self):
        return 0

    def riotIn(self, riotable):
        return riotable[0]

    def seekIn(self, twice, seeker, choices):
        if not choices:
            return -1, -1
        if len(choices) == 1 or not twice:
            return 0, -1
        return 0, 1

    def cloudP(self, card):
        return False
