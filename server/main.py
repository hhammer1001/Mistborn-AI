import logging
import traceback
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from server.session import SessionManager, CHARACTERS, BOT_TYPES
from server.multiplayer_session import MultiplayerGameSession
import server.instantdb_client as idb
import json

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("mistborn")

app = FastAPI(title="Mistborn Card Game API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = SessionManager()


class CreateGameRequest(BaseModel):
    playerName: str = "Player"
    character: str = "Kelsier"
    opponentType: str = "twonky"
    opponentCharacter: str = "Shan"
    botFirst: bool = True
    testDeck: bool = False


class ActionRequest(BaseModel):
    actionIndex: int


class PromptResponse(BaseModel):
    promptType: str
    value: int


class DamageRequest(BaseModel):
    targetIndex: int


class SenseRequest(BaseModel):
    use: bool


class CloudRequest(BaseModel):
    cardId: int


@app.get("/api/info")
def get_info():
    return {
        "characters": CHARACTERS,
        "botTypes": list(BOT_TYPES.keys()),
    }


@app.post("/api/games")
def create_game(req: CreateGameRequest):
    session = manager.create(
        player_name=req.playerName,
        character=req.character,
        opponent_type=req.opponentType,
        opponent_character=req.opponentCharacter,
        bot_first=req.botFirst,
        test_deck=req.testDeck,
    )
    return session.get_state()


@app.get("/api/games/{session_id}")
def get_game_state(session_id: str):
    session = manager.get(session_id)
    if not session:
        return {"error": "Session not found"}
    return session.get_state()


@app.post("/api/games/{session_id}/action")
def play_action(session_id: str, req: ActionRequest):
    session = manager.get(session_id)
    if not session:
        return {"error": "Session not found"}
    log.info(f"ACTION session={session_id[:8]} index={req.actionIndex} phase={session.phase}")
    try:
        result = session.play_action(req.actionIndex)
        log.info(f"  -> phase={session.phase} winner={session.game.winner}")
        return result
    except Exception as e:
        log.error(f"  -> ERROR: {e}\n{traceback.format_exc()}")
        return {"error": str(e)}


@app.post("/api/games/{session_id}/damage")
def assign_damage(session_id: str, req: DamageRequest):
    session = manager.get(session_id)
    if not session:
        return {"error": "Session not found"}
    log.info(f"DAMAGE session={session_id[:8]} target={req.targetIndex}")
    try:
        result = session.assign_damage(req.targetIndex)
        log.info(f"  -> phase={session.phase}")
        return result
    except Exception as e:
        log.error(f"  -> ERROR: {e}\n{traceback.format_exc()}")
        return {"error": str(e)}


@app.post("/api/games/{session_id}/sense")
def resolve_sense(session_id: str, req: SenseRequest):
    session = manager.get(session_id)
    if not session:
        return {"error": "Session not found"}
    log.info(f"SENSE session={session_id[:8]} use={req.use}")
    try:
        result = session.resolve_sense(req.use)
        log.info(f"  -> phase={session.phase}")
        return result
    except Exception as e:
        log.error(f"  -> ERROR: {e}\n{traceback.format_exc()}")
        return {"error": str(e)}


@app.post("/api/games/{session_id}/cloud")
def resolve_cloud(session_id: str, req: CloudRequest):
    session = manager.get(session_id)
    if not session:
        return {"error": "Session not found"}
    log.info(f"CLOUD session={session_id[:8]} cardId={req.cardId}")
    try:
        result = session.resolve_cloud(req.cardId)
        log.info(f"  -> phase={session.phase}")
        return result
    except Exception as e:
        log.error(f"  -> ERROR: {e}\n{traceback.format_exc()}")
        return {"error": str(e)}


@app.post("/api/games/{session_id}/prompt")
def respond_to_prompt(session_id: str, req: PromptResponse):
    session = manager.get(session_id)
    if not session:
        return {"error": "Session not found"}
    log.info(f"PROMPT session={session_id[:8]} type={req.promptType} value={req.value}")
    try:
        result = session.respond_to_prompt(req.promptType, req.value)
        log.info(f"  -> phase={session.phase}")
        return result
    except Exception as e:
        log.error(f"  -> ERROR: {e}\n{traceback.format_exc()}")
        return {"error": str(e)}


@app.delete("/api/games/{session_id}")
def delete_game(session_id: str):
    manager.delete(session_id)
    return {"ok": True}


# ── Multiplayer endpoints ──


class MPCreateRequest(BaseModel):
    roomId: str
    p0Id: str
    p0Name: str
    p0Char: str
    p1Id: str
    p1Name: str
    p1Char: str


class MPActionRequest(BaseModel):
    sessionId: str
    playerId: str  # InstantDB user ID
    actionIndex: int


class MPPromptRequest(BaseModel):
    sessionId: str
    playerId: str
    promptType: str
    value: int


class MPDamageRequest(BaseModel):
    sessionId: str
    playerId: str
    targetIndex: int


class MPSenseRequest(BaseModel):
    sessionId: str
    playerId: str
    use: bool


class MPCloudRequest(BaseModel):
    sessionId: str
    playerId: str
    cardId: int


class MPForfeitRequest(BaseModel):
    sessionId: str
    playerId: str


def _load_mp_session(session_id: str):
    """Load a multiplayer session from InstantDB."""
    game_record = idb.get_game(session_id)
    if not game_record:
        return None, None
    session = MultiplayerGameSession.from_pickle_b64(game_record["engineState"])
    return session, game_record


def _resolve_player_index(game_record: dict, player_id: str) -> int:
    """Map a player's user ID to their index (0 or 1)."""
    if game_record["p0Id"] == player_id:
        return 0
    if game_record["p1Id"] == player_id:
        return 1
    raise ValueError("Player not in this game")


def _save_mp_session(session_id: str, session: MultiplayerGameSession):
    """Save the session state back to InstantDB."""
    p0_state, p1_state = session.get_both_states()

    # Determine prompt data
    p0_prompt = None
    p1_prompt = None
    if session._pending_prompt and session.phase == "awaiting_prompt":
        prompt_data = session._pending_prompt.to_dict()
        if session.active_player == 0:
            p0_prompt = prompt_data
        else:
            p1_prompt = prompt_data

    idb.update_game(session_id, {
        "engineState": session.to_pickle_b64(),
        "phase": session.phase,
        "activePlayer": session.active_player,
        "turnCount": session.game.turncount,
        "p0State": p0_state,
        "p1State": p1_state,
        "p0Prompt": p0_prompt,
        "p1Prompt": p1_prompt,
        "winner": session.game.winner.name if session.game.winner else "",
        "victoryType": session.game.victoryType if session.game.victoryType else "",
        "updatedAt": int(time.time() * 1000),
    })


@app.post("/api/multiplayer/create")
def mp_create_game(req: MPCreateRequest):
    log.info(f"MP CREATE room={req.roomId} p0={req.p0Name}({req.p0Char}) p1={req.p1Name}({req.p1Char})")
    try:
        session = MultiplayerGameSession(
            p0_name=req.p0Name,
            p0_char=req.p0Char,
            p1_name=req.p1Name,
            p1_char=req.p1Char,
        )
        game_id = idb.new_id()
        p0_state, p1_state = session.get_both_states()

        idb.create_game(game_id, {
            "roomId": req.roomId,
            "engineState": session.to_pickle_b64(),
            "phase": session.phase,
            "activePlayer": session.active_player,
            "turnCount": session.game.turncount,
            "p0State": p0_state,
            "p1State": p1_state,
            "p0Prompt": None,
            "p1Prompt": None,
            "p0Log": [],
            "p1Log": [],
            "winner": "",
            "victoryType": "",
            "p0Id": req.p0Id,
            "p1Id": req.p1Id,
            "updatedAt": int(time.time() * 1000),
        })

        # Update room status
        idb.update_room_status(req.roomId, "in_game", sessionId=game_id)

        return {"sessionId": game_id}
    except Exception as e:
        log.error(f"  -> ERROR: {e}\n{traceback.format_exc()}")
        return {"error": str(e)}


@app.post("/api/multiplayer/action")
def mp_play_action(req: MPActionRequest):
    log.info(f"MP ACTION session={req.sessionId[:8]} player={req.playerId[:8]} index={req.actionIndex}")
    try:
        session, record = _load_mp_session(req.sessionId)
        if not session:
            return {"error": "Game not found"}
        pi = _resolve_player_index(record, req.playerId)
        result = session.play_action(pi, req.actionIndex)
        if result and "error" in result:
            return result
        _save_mp_session(req.sessionId, session)
        log.info(f"  -> phase={session.phase} active={session.active_player}")
        # Return the acting player's state so the client can chain composite actions
        return {"ok": True, "state": session.get_state(pi)}
    except Exception as e:
        log.error(f"  -> ERROR: {e}\n{traceback.format_exc()}")
        return {"error": str(e)}


@app.post("/api/multiplayer/prompt")
def mp_respond_to_prompt(req: MPPromptRequest):
    log.info(f"MP PROMPT session={req.sessionId[:8]} type={req.promptType} value={req.value}")
    try:
        session, record = _load_mp_session(req.sessionId)
        if not session:
            return {"error": "Game not found"}
        pi = _resolve_player_index(record, req.playerId)
        result = session.respond_to_prompt(pi, req.promptType, req.value)
        if result and "error" in result:
            return result
        _save_mp_session(req.sessionId, session)
        return {"ok": True}
    except Exception as e:
        log.error(f"  -> ERROR: {e}\n{traceback.format_exc()}")
        return {"error": str(e)}


@app.post("/api/multiplayer/damage")
def mp_assign_damage(req: MPDamageRequest):
    log.info(f"MP DAMAGE session={req.sessionId[:8]} target={req.targetIndex}")
    try:
        session, record = _load_mp_session(req.sessionId)
        if not session:
            return {"error": "Game not found"}
        pi = _resolve_player_index(record, req.playerId)
        result = session.assign_damage(pi, req.targetIndex)
        if result and "error" in result:
            return result
        _save_mp_session(req.sessionId, session)
        return {"ok": True}
    except Exception as e:
        log.error(f"  -> ERROR: {e}\n{traceback.format_exc()}")
        return {"error": str(e)}


@app.post("/api/multiplayer/sense")
def mp_resolve_sense(req: MPSenseRequest):
    log.info(f"MP SENSE session={req.sessionId[:8]} use={req.use}")
    try:
        session, record = _load_mp_session(req.sessionId)
        if not session:
            return {"error": "Game not found"}
        pi = _resolve_player_index(record, req.playerId)
        result = session.resolve_sense(pi, req.use)
        if result and "error" in result:
            return result
        _save_mp_session(req.sessionId, session)
        return {"ok": True}
    except Exception as e:
        log.error(f"  -> ERROR: {e}\n{traceback.format_exc()}")
        return {"error": str(e)}


@app.post("/api/multiplayer/cloud")
def mp_resolve_cloud(req: MPCloudRequest):
    log.info(f"MP CLOUD session={req.sessionId[:8]} cardId={req.cardId}")
    try:
        session, record = _load_mp_session(req.sessionId)
        if not session:
            return {"error": "Game not found"}
        pi = _resolve_player_index(record, req.playerId)
        result = session.resolve_cloud(pi, req.cardId)
        if result and "error" in result:
            return result
        _save_mp_session(req.sessionId, session)
        return {"ok": True}
    except Exception as e:
        log.error(f"  -> ERROR: {e}\n{traceback.format_exc()}")
        return {"error": str(e)}


@app.post("/api/multiplayer/forfeit")
def mp_forfeit(req: MPForfeitRequest):
    log.info(f"MP FORFEIT session={req.sessionId[:8]} player={req.playerId[:8]}")
    try:
        session, record = _load_mp_session(req.sessionId)
        if not session:
            return {"error": "Game not found"}
        pi = _resolve_player_index(record, req.playerId)
        session.forfeit(pi)
        _save_mp_session(req.sessionId, session)
        return {"ok": True}
    except Exception as e:
        log.error(f"  -> ERROR: {e}\n{traceback.format_exc()}")
        return {"error": str(e)}


@app.websocket("/ws/{session_id}")
async def websocket_game(websocket: WebSocket, session_id: str):
    session = manager.get(session_id)
    if not session:
        await websocket.close(code=4004, reason="Session not found")
        return

    await websocket.accept()

    try:
        # Send initial state
        await websocket.send_json(session.get_state())

        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "action":
                state = session.play_action(msg["actionIndex"])
                await websocket.send_json(state)
            elif msg.get("type") == "state":
                await websocket.send_json(session.get_state())
            else:
                await websocket.send_json({"error": f"Unknown message type: {msg.get('type')}"})

    except WebSocketDisconnect:
        pass
