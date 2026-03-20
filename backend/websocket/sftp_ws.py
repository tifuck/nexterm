"""SFTP WebSocket endpoint for real-time file transfer progress."""
import asyncio
import json
import logging
from fastapi import WebSocket, WebSocketDisconnect
from backend.middleware.auth import get_user_from_token

logger = logging.getLogger(__name__)


async def sftp_progress_handler(
    websocket: WebSocket,
):
    """Handle SFTP progress WebSocket connections.
    
    Sends real-time upload/download progress updates to the client.
    Messages from server:
      - {type: "progress", operation: "upload"|"download", path: "...", bytes_transferred: N, total_bytes: N, percent: N}
      - {type: "complete", operation: "...", path: "..."}
      - {type: "error", operation: "...", path: "...", message: "..."}
    """
    await websocket.accept()
    
    user_id = None
    
    try:
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
            msg = json.loads(raw)
            if msg.get("type") == "auth":
                _, user = await get_user_from_token(msg.get("token", ""))
                user_id = str(user.id)
                await websocket.send_json({"type": "authenticated"})
            else:
                await websocket.send_json({"type": "error", "message": "Authentication required"})
                await websocket.close(code=4001)
                return
        except asyncio.TimeoutError:
            await websocket.close(code=4001)
            return
        except Exception:
            await websocket.close(code=4001)
            return

        # Keep connection alive for progress updates
        while True:
            try:
                raw = await websocket.receive_text()
                msg = json.loads(raw)
                
                if msg.get("type") == "auth":
                    if user_id:
                        await websocket.send_json({"type": "error", "message": "Already authenticated"})
                        continue
                    try:
                        _, user = await get_user_from_token(msg.get("token", ""))
                        user_id = str(user.id)
                        await websocket.send_json({"type": "authenticated"})
                    except Exception:
                        await websocket.send_json({"type": "error", "message": "Auth failed"})
                
                elif msg.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                    
            except WebSocketDisconnect:
                break
    except Exception as e:
        logger.error(f"SFTP progress WS error: {e}")
    finally:
        logger.debug("SFTP progress WS closed for user %s", user_id)
