import pytest
import json
from fastapi.testclient import TestClient
from server.main import app
from server.session import GameSession, SessionManager


client = TestClient(app)


class TestGameSession:
    def test_create_session(self):
        session = GameSession()
        assert session.id
        assert session.phase == "actions"
        assert session.human is not None
        assert session.bot is not None

    def test_get_state(self):
        session = GameSession()
        state = session.get_state()
        assert "sessionId" in state
        assert "phase" in state
        assert "availableActions" in state
        assert "players" in state
        assert "market" in state
        assert "missions" in state
        assert len(state["availableActions"]) > 0

    def test_play_action_end_turn(self):
        session = GameSession()
        state = session.get_state()
        # Action index 0 is always "end actions"
        end_action = [a for a in state["availableActions"] if a["code"] == 0]
        assert len(end_action) == 1
        new_state = session.play_action(end_action[0]["index"])
        assert "error" not in new_state

    def test_play_multiple_turns(self):
        session = GameSession()
        for _ in range(5):
            if session.phase == "game_over":
                break
            state = session.get_state()
            # Just end each turn immediately
            end_idx = [a for a in state["availableActions"] if a["code"] == 0][0]["index"]
            session.play_action(end_idx)

    def test_play_until_game_over(self):
        session = GameSession()
        for _ in range(600):
            if session.phase == "game_over":
                break
            state = session.get_state()
            end_idx = [a for a in state["availableActions"] if a["code"] == 0][0]["index"]
            session.play_action(end_idx)
        state = session.get_state()
        assert state["winner"] is not None

    def test_invalid_action_index(self):
        session = GameSession()
        result = session.play_action(999)
        assert "error" in result

    def test_state_is_json_serializable(self):
        session = GameSession()
        json.dumps(session.get_state())


class TestSessionManager:
    def test_create_and_get(self):
        mgr = SessionManager()
        session = mgr.create(player_name="Test")
        assert mgr.get(session.id) is session

    def test_delete(self):
        mgr = SessionManager()
        session = mgr.create()
        mgr.delete(session.id)
        assert mgr.get(session.id) is None

    def test_get_nonexistent(self):
        mgr = SessionManager()
        assert mgr.get("nonexistent") is None


class TestRESTEndpoints:
    def test_get_info(self):
        resp = client.get("/api/info")
        assert resp.status_code == 200
        data = resp.json()
        assert "characters" in data
        assert "botTypes" in data

    def test_create_game(self):
        resp = client.post("/api/games", json={
            "playerName": "Henry",
            "character": "Kelsier",
            "opponentType": "twonky",
            "opponentCharacter": "Marsh",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "sessionId" in data
        assert "availableActions" in data
        assert data["phase"] == "actions"

    def test_get_game_state(self):
        resp = client.post("/api/games", json={"playerName": "Henry"})
        session_id = resp.json()["sessionId"]

        resp = client.get(f"/api/games/{session_id}")
        assert resp.status_code == 200
        assert resp.json()["sessionId"] == session_id

    def test_play_action(self):
        resp = client.post("/api/games", json={"playerName": "Henry"})
        data = resp.json()
        session_id = data["sessionId"]
        end_action = [a for a in data["availableActions"] if a["code"] == 0][0]

        resp = client.post(f"/api/games/{session_id}/action", json={
            "actionIndex": end_action["index"],
        })
        assert resp.status_code == 200
        assert "error" not in resp.json()

    def test_delete_game(self):
        resp = client.post("/api/games", json={"playerName": "Henry"})
        session_id = resp.json()["sessionId"]

        resp = client.delete(f"/api/games/{session_id}")
        assert resp.status_code == 200

        resp = client.get(f"/api/games/{session_id}")
        assert resp.json().get("error") == "Session not found"

    def test_nonexistent_session(self):
        resp = client.get("/api/games/fake-id")
        assert resp.json()["error"] == "Session not found"


class TestWebSocket:
    def test_websocket_connect_and_receive_state(self):
        resp = client.post("/api/games", json={"playerName": "Henry"})
        session_id = resp.json()["sessionId"]

        with client.websocket_connect(f"/ws/{session_id}") as ws:
            state = ws.receive_json()
            assert "sessionId" in state
            assert "availableActions" in state

    def test_websocket_send_action(self):
        resp = client.post("/api/games", json={"playerName": "Henry"})
        data = resp.json()
        session_id = data["sessionId"]

        with client.websocket_connect(f"/ws/{session_id}") as ws:
            initial = ws.receive_json()
            end_action = [a for a in initial["availableActions"] if a["code"] == 0][0]

            ws.send_json({"type": "action", "actionIndex": end_action["index"]})
            new_state = ws.receive_json()
            assert "error" not in new_state

    def test_websocket_request_state(self):
        resp = client.post("/api/games", json={"playerName": "Henry"})
        session_id = resp.json()["sessionId"]

        with client.websocket_connect(f"/ws/{session_id}") as ws:
            ws.receive_json()  # initial state
            ws.send_json({"type": "state"})
            state = ws.receive_json()
            assert "sessionId" in state

    def test_websocket_invalid_session(self):
        with pytest.raises(Exception):
            with client.websocket_connect("/ws/fake-id") as ws:
                ws.receive_json()
