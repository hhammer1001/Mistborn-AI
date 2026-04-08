from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from server.session import SessionManager, CHARACTERS, BOT_TYPES
import json

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
    return session.play_action(req.actionIndex)


@app.post("/api/games/{session_id}/prompt")
def respond_to_prompt(session_id: str, req: PromptResponse):
    session = manager.get(session_id)
    if not session:
        return {"error": "Session not found"}
    return session.respond_to_prompt(req.promptType, req.value)


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
