"""MediaPipe Tasks Hand Landmarker, không dùng API mp.solutions cũ."""
from pathlib import Path
import cv2
import numpy as np

MODEL_PATH = Path(__file__).resolve().parent / "models" / "hand_landmarker.task"
CONNECTIONS = (
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (0, 17), (17, 18), (18, 19), (19, 20),
)


class HandDetector:
    def __init__(self, num_hands=2):
        import mediapipe as mp
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
        if not MODEL_PATH.is_file():
            raise FileNotFoundError("Thiếu AI/models/hand_landmarker.task. Chạy install.bat để tải lại model.")
        self.mp = mp
        # Cấu hình cân bằng: Kháng nhiễu nền giả lập đồng thời giữ tracking tốt
        options = vision.HandLandmarkerOptions(
            base_options=python.BaseOptions(
                model_asset_buffer=MODEL_PATH.read_bytes(),
                delegate=python.BaseOptions.Delegate.CPU,
            ),
            running_mode=vision.RunningMode.VIDEO,
            num_hands=num_hands,
            min_hand_detection_confidence=0.55,
            min_hand_presence_confidence=0.50,
            min_tracking_confidence=0.45,
        )
        self.landmarker = vision.HandLandmarker.create_from_options(options)
        self.last_timestamp = -1

    def detect(self, mirrored_bgr: np.ndarray, timestamp_ms: int) -> list[dict]:
        # VIDEO nhận tuần tự các frame webcam đã giải mã; timestamp phải tăng.
        timestamp_ms = max(timestamp_ms, self.last_timestamp + 1)
        self.last_timestamp = timestamp_ms
        rgb = np.ascontiguousarray(cv2.cvtColor(mirrored_bgr, cv2.COLOR_BGR2RGB))
        result = self.landmarker.detect_for_video(
            self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb), timestamp_ms
        )
        hands = []
        for index, landmarks in enumerate(result.hand_landmarks):
            category = result.handedness[index][0]
            hands.append({
                "index": index,
                "handedness": category.category_name,
                "handedness_score": float(category.score),
                "landmarks": [{"x": float(p.x), "y": float(p.y), "z": float(p.z)} for p in landmarks],
            })
        return hands

    def close(self):
        self.landmarker.close()


def draw_hands(frame: np.ndarray, hands: list[dict]) -> np.ndarray:
    """Vẽ lên bản sao đúng frame đã nhận dạng, không ghép kết quả với frame mới hơn."""
    output = frame.copy()
    height, width = output.shape[:2]
    colors = ((114, 233, 72), (230, 190, 65))  # BGR
    for hand in hands:
        color = colors[hand["index"] % len(colors)]
        points = [(round(p["x"] * (width - 1)), round(p["y"] * (height - 1))) for p in hand["landmarks"]]
        for a, b in CONNECTIONS:
            cv2.line(output, points[a], points[b], color, 2, cv2.LINE_AA)
        for i, point in enumerate(points):
            cv2.circle(output, point, 4 if i in (0, 4, 8, 12, 16, 20) else 3, (255, 255, 255), -1, cv2.LINE_AA)
            cv2.circle(output, point, 2, color, -1, cv2.LINE_AA)
    return output
