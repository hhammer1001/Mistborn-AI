"""InstantDB Admin HTTP API client for server-side game state management."""

import os
import uuid
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

INSTANTDB_API = "https://api.instantdb.com"
APP_ID = os.environ.get("INSTANTDB_APP_ID", "")
ADMIN_TOKEN = os.environ.get("INSTANTDB_ADMIN_TOKEN", "")


def _headers():
    return {
        "Authorization": f"Bearer {ADMIN_TOKEN}",
        "App-Id": APP_ID,
        "Content-Type": "application/json",
    }


def query(q: dict) -> dict:
    """Run an InstaQL query. Returns the data dict."""
    resp = requests.post(
        f"{INSTANTDB_API}/admin/query",
        headers=_headers(),
        json={"query": q},
    )
    resp.raise_for_status()
    return resp.json()


def transact(steps: list) -> dict:
    """Run a transaction with a list of steps.

    Each step is a tuple/list like:
      ["update", "namespace", "entity-id", {"field": "value"}]
      ["delete", "namespace", "entity-id"]
      ["link", "namespace", "entity-id", {"relation": "target-id"}]
    """
    resp = requests.post(
        f"{INSTANTDB_API}/admin/transact",
        headers=_headers(),
        json={"steps": steps},
    )
    resp.raise_for_status()
    return resp.json()


def new_id() -> str:
    """Generate a new UUID for InstantDB entities."""
    return str(uuid.uuid4())


# ── Game-specific helpers ──


def get_game(game_id: str) -> dict | None:
    """Fetch a game record by ID."""
    result = query({"games": {"$": {"where": {"id": game_id}}}})
    games = result.get("games", [])
    return games[0] if games else None


def create_game(game_id: str, data: dict):
    """Create a new game record."""
    transact([["update", "games", game_id, data]])


def update_game(game_id: str, data: dict):
    """Update an existing game record."""
    transact([["update", "games", game_id, data]])


def update_room_status(room_id: str, status: str, **extra):
    """Update a room's status and optional extra fields."""
    data = {"status": status, **extra}
    transact([["update", "rooms", room_id, data]])


def update_user_stats(user_profile_id: str, field: str, increment: int = 1):
    """Increment a user profile stat (wins, losses, draws).

    InstantDB doesn't have atomic increment, so we read-then-write.
    """
    result = query({"profiles": {"$": {"where": {"id": user_profile_id}}}})
    profiles = result.get("profiles", [])
    if not profiles:
        return
    current = profiles[0].get(field, 0)
    transact([["update", "profiles", user_profile_id, {field: current + increment}]])
