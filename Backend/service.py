import asyncio
import time
from uuid import uuid4
from fastapi import HTTPException
from .camera.source import CameraConfig
from .camera.runtime import CameraRuntime


class CameraService:
    def __init__(self, runtime=None, lease_seconds=15):
        self.runtime = runtime or CameraRuntime()
        self.lock = asyncio.Lock()
        self.session_id = None
        self.owner = None
        self.last_heartbeat = 0.0
        self.lease_seconds = lease_seconds

    def check(self, session_id):
        if session_id != self.session_id:
            raise HTTPException(404, "Phiên camera đã kết thúc hoặc không tồn tại.")

    async def start(self, client_id, camera_index):
        async with self.lock:
            if self.runtime.is_alive():
                if self.owner == client_id and self.runtime.snapshot()["state"] in ("starting", "running"):
                    self.last_heartbeat = time.monotonic()
                    return self.status(self.session_id)
                raise HTTPException(409, "Camera đang được một tab sử dụng hoặc đang dừng. Hãy tắt camera ở tab đó trước.")
            self.session_id = str(uuid4())
            self.owner = client_id
            self.last_heartbeat = time.monotonic()
            self.runtime.start(CameraConfig(device_index=camera_index))
            return self.status(self.session_id)

    def status(self, session_id):
        self.check(session_id)
        return {"session_id": self.session_id, **self.runtime.snapshot()}

    def heartbeat(self, session_id):
        self.check(session_id)
        self.last_heartbeat = time.monotonic()
        return {"ok": True}

    async def stop(self, session_id):
        async with self.lock:
            self.check(session_id)
            done = await asyncio.to_thread(self.runtime.stop)
            if not done:
                raise HTTPException(409, "Camera chưa dừng xong. Nếu driver bị treo, đóng server rồi chạy lại.")
            return self.status(session_id)

    def subscribe_gestures(self, loop: asyncio.AbstractEventLoop) -> tuple[asyncio.Queue, callable]:
        queue = asyncio.Queue()

        def listener(event):
            loop.call_soon_threadsafe(queue.put_nowait, event)

        self.runtime.add_gesture_listener(listener)

        def unsubscribe():
            self.runtime.remove_gesture_listener(listener)

        return queue, unsubscribe

    async def watchdog(self):
        while True:
            await asyncio.sleep(1)
            async with self.lock:
                if self.runtime.is_alive() and time.monotonic() - self.last_heartbeat > self.lease_seconds:
                    await asyncio.to_thread(self.runtime.stop)

    async def close(self):
        await asyncio.to_thread(self.runtime.stop)
