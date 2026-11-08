from contextlib import asynccontextmanager, suppress
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID
import asyncio
import mimetypes
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from .service import CameraService

ROOT = Path(__file__).resolve().parent.parent
mimetypes.add_type("application/javascript", ".mjs")  # Windows registry có thể thiếu MIME này.
mimetypes.add_type("application/wasm", ".wasm")


class StartRequest(BaseModel):
    client_id: UUID
    camera_index: int = Field(default=0, ge=0, le=4)


def create_app(service=None):
    camera = service or CameraService()

    @asynccontextmanager
    async def lifespan(app):
        watchdog = asyncio.create_task(camera.watchdog())
        try:
            yield
        finally:
            watchdog.cancel()
            with suppress(asyncio.CancelledError):
                await watchdog
            await camera.close()

    app = FastAPI(title="Gesture Slide Baseline", lifespan=lifespan)
    app.state.camera = camera

    @app.middleware("http")
    async def local_api_only(request: Request, call_next):
        # Camera vật lý local: không cho một trang web khác gọi lệnh bật camera.
        host = request.url.hostname
        if host not in ("127.0.0.1", "localhost", "::1", "testserver"):
            return JSONResponse({"detail": "Chỉ sử dụng ứng dụng qua localhost."}, status_code=403)
        if request.url.path.startswith("/api/") and request.method == "POST":
            origin = request.headers.get("origin")
            if origin and origin != f"{request.url.scheme}://{request.headers.get('host')}":
                return JSONResponse({"detail": "Origin không hợp lệ."}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/")
    def index():
        return FileResponse(ROOT / "Frontend" / "index.html")

    @app.get("/favicon.ico", include_in_schema=False)
    def favicon():
        return Response(status_code=204)

    @app.get("/api/health")
    def health():
        return {"ok": True, "mode": "local-camera", "model_ready": (ROOT / "AI/models/hand_landmarker.task").is_file()}

    @app.post("/api/camera/start")
    async def start(body: StartRequest):
        return await camera.start(str(body.client_id), body.camera_index)

    @app.get("/api/camera/{session_id}/status")
    def status(session_id: str):
        return camera.status(session_id)

    @app.post("/api/camera/{session_id}/heartbeat")
    async def heartbeat(session_id: str):
        return camera.heartbeat(session_id)

    @app.post("/api/camera/{session_id}/stop")
    async def stop(session_id: str):
        return await camera.stop(session_id)

    @app.get("/api/camera/{session_id}/preview")
    async def preview(session_id: str, request: Request):
        camera.check(session_id)

        async def frames():
            sequence = 0
            while camera.session_id == session_id:
                if await request.is_disconnected():
                    break
                new_sequence, jpeg, state = await asyncio.to_thread(camera.runtime.wait_frame, sequence)
                # Kiểm tra lại sau await để không đưa frame phiên mới vào stream cũ.
                if camera.session_id != session_id or state in ("stopped", "error", "stopping"):
                    break
                if jpeg is not None and new_sequence > sequence:
                    sequence = new_sequence
                    yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                           + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
        return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")

    @app.websocket("/ws/gesture/{session_id}")
    async def gesture_ws(websocket: WebSocket, session_id: str):
        if camera.session_id != session_id:
            await websocket.close(code=4004, reason="Phiên không hợp lệ hoặc đã hết hạn.")
            return
        await websocket.accept()
        loop = asyncio.get_running_loop()
        queue, unsubscribe = camera.subscribe_gestures(loop)
        try:
            while camera.session_id == session_id:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=2.0)
                    await websocket.send_json(event)
                except asyncio.TimeoutError:
                    await websocket.send_json({"type": "ping", "session_id": session_id})
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            unsubscribe()

    app.mount("/static", StaticFiles(directory=ROOT / "Frontend"), name="static")
    return app


app = create_app()
