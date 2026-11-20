from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from pathlib import Path
from uuid import UUID
import asyncio
import mimetypes
import os
import shutil
import time
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from .service import CameraService

ROOT = Path(__file__).resolve().parent.parent
NEW_UI_DIR = ROOT / "new-ui"
DEFAULT_FILES_DIR = ROOT / "Backend" / "file"
mimetypes.add_type("application/javascript", ".mjs")  # Windows registry có thể thiếu MIME này.
mimetypes.add_type("application/wasm", ".wasm")


class StartRequest(BaseModel):
    client_id: UUID
    camera_index: int = Field(default=0, ge=0, le=4)


class CreateFolderRequest(BaseModel):
    path: str = "/"
    name: str = ""


class GestureTriggerRequest(BaseModel):
    gesture: str


def create_app(service=None, files_dir=None):
    camera = service or CameraService()
    files_root = Path(files_dir or os.environ.get("HMI_FILE_DIR") or DEFAULT_FILES_DIR).resolve()
    files_root.mkdir(parents=True, exist_ok=True)
    global_gesture_queues: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = set()
    manual_gesture_seq = 0

    def error_json(message: str, status_code: int = 400):
        return JSONResponse({"error": message, "detail": message}, status_code=status_code)

    def resolve_file_path(req_path: str | None) -> Path:
        raw = (req_path or "").strip()
        if "\x00" in raw:
            raise ValueError("Forbidden: Access outside root directory")
        rel = raw.replace("\\", "/").lstrip("/")
        candidate = (files_root / rel).resolve() if rel else files_root
        try:
            candidate.relative_to(files_root)
        except ValueError as exc:
            raise ValueError("Forbidden: Access outside root directory") from exc
        return candidate

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

    app = FastAPI(title="Gesture Slide", lifespan=lifespan)
    app.state.camera = camera

    @app.middleware("http")
    async def local_api_only(request: Request, call_next):
        # Camera vật lý local: không cho một trang web khác gọi lệnh bật camera.
        host = request.url.hostname
        if host not in ("127.0.0.1", "localhost", "::1", "testserver"):
            return JSONResponse({"detail": "Chỉ sử dụng ứng dụng qua localhost."}, status_code=403)
        if request.url.path.startswith("/api/") and request.method in ("POST", "DELETE"):
            origin = request.headers.get("origin")
            if origin and origin != f"{request.url.scheme}://{request.headers.get('host')}":
                return JSONResponse({"detail": "Origin không hợp lệ."}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/")
    @app.get("/index.html")
    def index():
        return FileResponse(NEW_UI_DIR / "index.html")

    @app.get("/camera.html")
    def camera_page():
        return FileResponse(NEW_UI_DIR / "camera.html")

    @app.get("/favicon.ico", include_in_schema=False)
    def favicon():
        return Response(status_code=204)

    @app.get("/api/health")
    def health():
        return {"ok": True, "mode": "local-camera", "model_ready": (ROOT / "AI/models/hand_landmarker.task").is_file()}

    @app.get("/api/files")
    def list_files(path: str = "/"):
        try:
            dir_path = resolve_file_path(path)
            if not dir_path.is_dir():
                return error_json("Directory not found.", 400)
            files = []
            for entry in dir_path.iterdir():
                st = entry.stat()
                files.append({
                    "name": entry.name,
                    "isDirectory": entry.is_dir(),
                    "size": st.st_size,
                    "mtime": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
                })
            return {"currentPath": path or "/", "files": files}
        except Exception as exc:
            return error_json(str(exc), 400)

    @app.get("/api/view")
    def view_file(path: str):
        try:
            file_path = resolve_file_path(path)
            if not file_path.is_file():
                return error_json("Path is a directory.", 400)
            media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
            return FileResponse(file_path, media_type=media_type, headers={"Content-Disposition": "inline"})
        except Exception as exc:
            return error_json(str(exc), 400)

    @app.get("/api/download")
    def download_file(path: str):
        try:
            file_path = resolve_file_path(path)
            if not file_path.is_file():
                return error_json("Path is not a file.", 400)
            return FileResponse(file_path, filename=file_path.name)
        except Exception as exc:
            return error_json(str(exc), 400)

    @app.post("/api/upload")
    async def upload_files(request: Request):
        try:
            content_type = request.headers.get("content-type", "")
            if "multipart/form-data" not in content_type.lower():
                return error_json("No files provided.", 400)
            body = await request.body()
            raw_message = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("latin-1") + body
            msg = BytesParser(policy=policy.default).parsebytes(raw_message)

            target_path = "/"
            uploaded_items: list[tuple[str, bytes]] = []
            for part in msg.iter_parts():
                part_name = part.get_param("name", header="content-disposition")
                filename = part.get_filename()
                payload = part.get_payload(decode=True) or b""
                if part_name == "path" and filename is None:
                    target_path = payload.decode("utf-8", errors="replace")
                elif part_name == "files" and filename:
                    safe_name = filename.replace("\\", "/").rsplit("/", 1)[-1]
                    if not safe_name or safe_name in (".", "..") or "\x00" in safe_name:
                        return error_json("Invalid file name.", 400)
                    uploaded_items.append((safe_name, payload))

            if not uploaded_items:
                return error_json("No files provided.", 400)

            target_dir = resolve_file_path(target_path)
            if not target_dir.is_dir():
                return error_json("Target directory does not exist.", 400)

            for safe_name, payload in uploaded_items:
                destination = (target_dir / safe_name).resolve()
                try:
                    destination.relative_to(files_root)
                except ValueError as exc:
                    raise ValueError("Forbidden path.") from exc
                destination.write_bytes(payload)

            return {"message": "Files uploaded successfully."}
        except Exception as exc:
            return error_json(str(exc), 400)

    @app.post("/api/create-folder")
    @app.post("/api/folder")
    def create_folder(body: CreateFolderRequest):
        try:
            folder_name = (body.name or "").strip()
            if not folder_name:
                return error_json("Folder name is required.", 400)
            if "/" in folder_name or "\\" in folder_name or folder_name in (".", "..") or "\x00" in folder_name:
                return error_json("Invalid folder name.", 400)

            parent_dir = resolve_file_path(body.path or "/")
            if not parent_dir.is_dir():
                return error_json("Parent directory does not exist.", 400)

            new_folder = (parent_dir / folder_name).resolve()
            try:
                new_folder.relative_to(files_root)
            except ValueError as exc:
                raise ValueError("Forbidden path.") from exc

            new_folder.mkdir()
            return {"message": "Folder created successfully.", "name": folder_name}
        except FileExistsError:
            return error_json("A file or folder with this name already exists.", 400)
        except Exception as exc:
            return error_json(str(exc), 400)

    @app.delete("/api/delete")
    async def delete_item(request: Request, path: str | None = None):
        try:
            target_req = path
            if not target_req:
                with suppress(Exception):
                    body = await request.json()
                    if isinstance(body, dict):
                        target_req = body.get("path")
            if not target_req:
                return error_json("Cannot delete root directory.", 400)

            target_path = resolve_file_path(target_req)
            if target_path == files_root:
                return error_json("Cannot delete root directory.", 400)
            if not target_path.exists() and not target_path.is_symlink():
                return error_json("Item not found.", 400)

            if target_path.is_dir() and not target_path.is_symlink():
                shutil.rmtree(target_path)
            else:
                target_path.unlink(missing_ok=True)
            return {"message": "Item deleted."}
        except Exception as exc:
            return error_json(str(exc), 400)

    @app.post("/api/gesture")
    def trigger_gesture(body: GestureTriggerRequest):
        nonlocal manual_gesture_seq
        if body.gesture not in ("SWIPE_LEFT", "SWIPE_RIGHT"):
            return error_json("Invalid gesture. Must be SWIPE_LEFT or SWIPE_RIGHT.", 400)
        manual_gesture_seq += 1
        event = {
            "gesture": body.gesture,
            "sequence": manual_gesture_seq,
            "timestamp": int(time.time() * 1000),
        }
        for loop, queue in list(global_gesture_queues):
            with suppress(Exception):
                loop.call_soon_threadsafe(queue.put_nowait, event)
        return {"ok": True, "gesture": body.gesture, "sequence": manual_gesture_seq}

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

    @app.websocket("/ws/gesture")
    async def global_gesture_ws(websocket: WebSocket):
        await websocket.accept()
        loop = asyncio.get_running_loop()
        merged_queue: asyncio.Queue = asyncio.Queue()
        subscription = (loop, merged_queue)
        global_gesture_queues.add(subscription)
        cam_queue, unsubscribe_cam = camera.subscribe_gestures(loop)

        async def forward_camera_events():
            while True:
                ev = await cam_queue.get()
                await merged_queue.put(ev)

        forwarder = asyncio.create_task(forward_camera_events())
        try:
            while True:
                try:
                    event = await asyncio.wait_for(merged_queue.get(), timeout=2.0)
                    await websocket.send_json(event)
                except asyncio.TimeoutError:
                    await websocket.send_json({"type": "ping"})
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            forwarder.cancel()
            with suppress(asyncio.CancelledError):
                await forwarder
            unsubscribe_cam()
            global_gesture_queues.discard(subscription)

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

    app.mount("/static", StaticFiles(directory=NEW_UI_DIR), name="static")
    if (NEW_UI_DIR / "vendor" / "pdfjs" / "build").is_dir():
        app.mount("/pdfjs", StaticFiles(directory=NEW_UI_DIR / "vendor" / "pdfjs" / "build"), name="pdfjs")
    app.mount("/new-ui", StaticFiles(directory=NEW_UI_DIR, html=True), name="new-ui")
    return app


app = create_app()
