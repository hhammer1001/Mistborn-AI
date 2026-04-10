import logging
import traceback
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from server.session import SessionManager, CHARACTERS, BOT_TYPES
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
