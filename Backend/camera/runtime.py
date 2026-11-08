from __future__ import annotations
import logging
import threading
import time
import cv2
import numpy as np
from .source import CameraConfig, CameraSource
from AI.filters.one_euro import OneEuroFilter3D
from AI.gestures.fsm import GestureAction, GestureFSM
from AI.hand_detector import HandDetector, draw_hands

log = logging.getLogger(__name__)


class CameraRuntime:
    """Một thread đọc camera, một thread suy luận AI; bộ đệm chỉ giữ frame mới nhất."""

    def __init__(self, source_factory=CameraSource, detector_factory=HandDetector):
        self.source_factory = source_factory
        self.detector_factory = detector_factory
        self.condition = threading.Condition()
        self.stop_event = threading.Event()
        self.worker = None
        self.capture_worker = None
        self.state = "stopped"
        self.error = None
        self.raw = None
        self.capture_error = None
        self.sequence = 0
        self.jpeg = None
        self.hands = []
        self.processing_ms = 0.0
        self.fps = 0.0
        self.dropped_frames = 0
        self.frame_id = 0

        # Bộ lọc thích ứng One-Euro và Máy trạng thái nhận diện cử chỉ
        self.filters = [OneEuroFilter3D(min_cutoff=1.0, beta=0.007) for _ in range(2)]
        self.gesture_fsm = GestureFSM()
        self.last_gesture = None
        self.last_gesture_time = 0.0
        self.gesture_sequence = 0
        self.gesture_listeners = []

    def is_alive(self):
        return any(t is not None and t.is_alive() for t in (self.worker, self.capture_worker))

    def add_gesture_listener(self, callback):
        with self.condition:
            if callback not in self.gesture_listeners:
                self.gesture_listeners.append(callback)

    def remove_gesture_listener(self, callback):
        with self.condition:
            if callback in self.gesture_listeners:
                self.gesture_listeners.remove(callback)

    def _dispatch_gesture_event(self, gesture: str, timestamp: float, sequence: int):
        with self.condition:
            listeners = list(self.gesture_listeners)
        event = {"gesture": gesture, "timestamp": timestamp, "sequence": sequence}
        for listener in listeners:
            try:
                listener(event)
            except Exception as exc:
                log.debug("Lỗi khi gọi listener gesture: %s", exc)

    def start(self, config: CameraConfig):
        if self.is_alive():
            raise RuntimeError("Camera trước chưa dừng xong.")
        with self.condition:
            self.stop_event.clear()
            self.raw = self.jpeg = self.capture_error = self.error = None
            self.hands = []
            self.state = "starting"
            self.sequence = self.dropped_frames = self.frame_id = 0
            self.processing_ms = self.fps = 0.0
            self.gesture_fsm.reset()
            for f in self.filters:
                f.reset()
            self.last_gesture = None
            self.last_gesture_time = 0.0
            self.gesture_sequence = 0
        self.worker = threading.Thread(target=self._run, args=(config,), daemon=True, name="hand-inference")
        self.worker.start()

    def request_stop(self):
        self.stop_event.set()
        with self.condition:
            if self.state in ("starting", "running"):
                self.state = "stopping"
            self.condition.notify_all()

    def stop(self, timeout=10.0):
        # MediaPipe native có thể mất khoảng 5 giây để đóng graph.
        # Camera được release trước; chờ model đóng xong rồi mới cho mở phiên mới.
        self.request_stop()
        deadline = time.monotonic() + timeout
        for thread in (self.worker, self.capture_worker):
            if thread and thread is not threading.current_thread():
                thread.join(max(0.0, deadline - time.monotonic()))
        return not self.is_alive()

    def snapshot(self):
        with self.condition:
            return {
                "state": self.state,
                "error": self.error,
                "frame_id": self.frame_id,
                "hand_count": len(self.hands),
                "hands": self.hands,
                "processing_ms": round(self.processing_ms, 1),
                "fps": round(self.fps, 1),
                "dropped_frames": self.dropped_frames,
                "last_gesture": self.last_gesture,
                "gesture_sequence": self.gesture_sequence,
                "gesture_state": self.gesture_fsm.state.value,
            }

    def wait_frame(self, after_sequence: int, timeout=1.0):
        with self.condition:
            self.condition.wait_for(
                lambda: self.sequence > after_sequence or self.state in ("stopped", "error", "stopping"), timeout
            )
            return self.sequence, self.jpeg, self.state

    def _capture(self, config, epoch):
        source = self.source_factory(config)
        try:
            if self.stop_event.is_set():
                return
            source.open()
            frame_id = 0
            while not self.stop_event.is_set():
                frame = source.read()
                captured_ms = int((time.perf_counter() - epoch) * 1000)
                frame_id += 1
                with self.condition:
                    if self.raw is not None:
                        self.dropped_frames += 1
                    self.raw = (frame_id, captured_ms, frame)
                    self.condition.notify_all()
        except Exception as exc:
            if not self.stop_event.is_set():
                with self.condition:
                    self.capture_error = str(exc)
                    self.condition.notify_all()
        finally:
            source.close()

    def _run(self, config):
        detector = None
        try:
            detector = self.detector_factory(config.num_hands)
            if self.stop_event.is_set():
                return
            epoch = time.perf_counter()
            self.capture_worker = threading.Thread(
                target=self._capture, args=(config, epoch), daemon=True, name="camera-capture"
            )
            self.capture_worker.start()
            last_frame_at = epoch
            last_done = None
            while not self.stop_event.is_set():
                with self.condition:
                    self.condition.wait_for(
                        lambda: self.raw is not None or self.capture_error or self.stop_event.is_set(), 0.5
                    )
                    if self.stop_event.is_set():
                        break
                    if self.capture_error:
                        raise RuntimeError(self.capture_error)
                    raw, self.raw = self.raw, None
                if raw is None:
                    if time.perf_counter() - last_frame_at > 10:
                        raise RuntimeError("Camera không trả frame trong 10 giây. Thử đổi camera hoặc driver.")
                    continue
                last_frame_at = time.perf_counter()
                frame_id, timestamp_ms, frame = raw
                if frame.ndim != 3 or frame.shape[2] != 3:
                    raise ValueError("Camera phải trả ảnh BGR ba kênh.")
                started = time.perf_counter()
                height, width = frame.shape[:2]
                if width > config.width or height > config.height:
                    scale = min(config.width / width, config.height / height)
                    frame = cv2.resize(frame, (max(1, round(width * scale)), max(1, round(height * scale))))
                frame = cv2.flip(frame, 1)  # Soi gương đúng một lần.

                # 1. Nhận diện MediaPipe
                raw_hands = detector.detect(frame, timestamp_ms)
                timestamp_sec = timestamp_ms / 1000.0

                # 2. Lọc nhiễu tọa độ 21 khớp bằng One-Euro Filter
                smoothed_hands = []
                for i, hand in enumerate(raw_hands):
                    filter_idx = hand.get("index", i) % len(self.filters)
                    raw_coords = np.array([[p["x"], p["y"], p["z"]] for p in hand["landmarks"]], dtype=np.float32)
                    smooth_coords = self.filters[filter_idx].filter(raw_coords, timestamp_sec)
                    
                    smoothed_hand = dict(hand)
                    smoothed_hand["landmarks"] = [
                        {"x": float(c[0]), "y": float(c[1]), "z": float(c[2])} for c in smooth_coords
                    ]
                    smoothed_hands.append(smoothed_hand)

                # 3. Phân loại cử chỉ bằng GestureFSM trên bàn tay chính
                current_action = GestureAction.NONE
                if smoothed_hands:
                    primary_landmarks = np.array(
                        [[p["x"], p["y"], p["z"]] for p in smoothed_hands[0]["landmarks"]],
                        dtype=np.float32,
                    )
                    current_action = self.gesture_fsm.update(primary_landmarks, timestamp_sec)
                else:
                    self.gesture_fsm.update(None, timestamp_sec)
                    for f in self.filters:
                        f.reset()

                if current_action != GestureAction.NONE:
                    self.gesture_sequence += 1
                    self.last_gesture = current_action.value
                    self.last_gesture_time = timestamp_sec
                    self._dispatch_gesture_event(current_action.value, timestamp_sec, self.gesture_sequence)

                # 4. Vẽ khung xương đã làm mịn và nén ảnh xem trước
                annotated = draw_hands(frame, smoothed_hands)
                ok, encoded = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
                if not ok:
                    raise RuntimeError("Không tạo được ảnh xem trước.")
                done = time.perf_counter()
                with self.condition:
                    if self.stop_event.is_set():
                        break
                    self.frame_id, self.hands = frame_id, smoothed_hands
                    self.processing_ms = (done - started) * 1000
                    if last_done is not None:
                        instant = 1 / max(done - last_done, 0.0001)
                        self.fps = instant if not self.fps else 0.8 * self.fps + 0.2 * instant
                    last_done = done
                    self.jpeg = encoded.tobytes()
                    self.sequence += 1
                    self.state = "running"
                    self.condition.notify_all()
        except Exception as exc:
            log.exception("Camera/MediaPipe failed")
            with self.condition:
                self.error = str(exc)
        finally:
            self.stop_event.set()
            if self.capture_worker:
                self.capture_worker.join(timeout=2)
            if detector is not None:
                try:
                    detector.close()
                except Exception as exc:
                    log.exception("Could not close MediaPipe")
                    with self.condition:
                        self.error = f"Không đóng được MediaPipe: {exc}"
            with self.condition:
                if self.capture_worker and self.capture_worker.is_alive():
                    self.error = "Driver camera chưa dừng. Đóng server rồi chạy lại run.bat."
                self.state = "error" if self.error else "stopped"
                self.raw = None
                self.jpeg = None
                self.hands = []
                self.gesture_fsm.reset()
                for f in self.filters:
                    f.reset()
                self.condition.notify_all()
