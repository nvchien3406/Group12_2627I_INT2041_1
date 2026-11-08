from collections import deque
from dataclasses import dataclass
import numpy as np


@dataclass
class KinematicSample:
    timestamp: float
    center_x: float
    center_y: float
    palm_size: float


class HandKinematics:
    """Theo dõi lịch sử chuyển động và trích xuất các đặc trưng động học chuẩn hóa (Scale-Invariant)."""

    def __init__(self, window_seconds: float = 0.38, max_samples: int = 30):
        self.window_seconds = window_seconds
        self.history: deque[KinematicSample] = deque(maxlen=max_samples)

    def reset(self):
        self.history.clear()

    @staticmethod
    def get_palm_metrics(landmarks: np.ndarray) -> tuple[float, float, float]:
        """Tính tâm bàn tay (center_x, center_y) và chiều dài chuẩn hóa L_palm."""
        wrist = landmarks[0]
        middle_mcp = landmarks[9]

        center_x = float((wrist[0] + middle_mcp[0]) * 0.5)
        center_y = float((wrist[1] + middle_mcp[1]) * 0.5)

        palm_size = float(np.linalg.norm(middle_mcp[:2] - wrist[:2]))
        palm_size = max(palm_size, 0.05)  # Tránh chia cho 0 hoặc giá trị quá nhỏ

        return center_x, center_y, palm_size

    def update(self, landmarks: np.ndarray, timestamp_sec: float) -> KinematicSample:
        """Cập nhật tọa độ mới vào chuỗi lịch sử và dọn dẹp các mẫu quá hạn."""
        center_x, center_y, palm_size = self.get_palm_metrics(landmarks)
        sample = KinematicSample(timestamp_sec, center_x, center_y, palm_size)
        self.history.append(sample)

        # Giữ lại các mẫu trong cửa sổ thời gian window_seconds
        cutoff = timestamp_sec - self.window_seconds
        while self.history and self.history[0].timestamp < cutoff:
            self.history.popleft()

        return sample

    def analyze_swipe(self) -> tuple[float, float, float, bool]:
        """Phân tích chuyển động lướt (Swipe) trong cửa sổ thời gian gần nhất.

        Trả về:
            dx_norm: Quãng đường di chuyển ngang chuẩn hóa theo L_palm (>0: sang phải, <0: sang trái)
            vx_norm: Vận tốc ngang chuẩn hóa (palms / giây)
            duration: Khoảng thời gian di chuyển (giây)
            is_valid_swipe: Đạt các tiêu chuẩn động học nghiêm ngặt về hướng và tính đơn điệu
        """
        if len(self.history) < 2:
            return 0.0, 0.0, 0.0, False

        oldest = self.history[0]
        newest = self.history[-1]

        dt = newest.timestamp - oldest.timestamp
        # Cú quẹt chuẩn diễn ra trong khoảng 0.05s - 0.38s
        if dt < 0.05 or dt > 0.38:
            return 0.0, 0.0, dt, False

        dx = newest.center_x - oldest.center_x
        dy = newest.center_y - oldest.center_y
        avg_palm = (newest.palm_size + oldest.palm_size) * 0.5

        dx_norm = dx / avg_palm
        dy_norm = dy / avg_palm
        vx_norm = dx_norm / dt

        abs_dx = abs(dx)
        abs_dy = abs(dy)

        # 1. Tiêu chí phương ngang áp đảo phương dọc: |dx| >= 1.7 * |dy| (góc lệch <= 30 độ)
        if abs_dx < 0.04 or (abs_dx < 1.7 * abs_dy):
            return dx_norm, vx_norm, dt, False

        # 2. Loại bỏ động tác hạ tay xuống bàn: nếu tay di chuyển xuống dưới quá nhiều
        if dy_norm > 0.30:
            return dx_norm, vx_norm, dt, False

        # 3. Tiêu chí tính đơn điệu (Monotonicity): không có nhiều bước quay đầu ngược chiều
        # Tránh việc khua tay qua lại, vẫy chào hoặc cử động ngẫu nhiên khi nói chuyện
        samples = list(self.history)
        steps = [samples[i + 1].center_x - samples[i].center_x for i in range(len(samples) - 1)]
        if not steps:
            return dx_norm, vx_norm, dt, False

        # Đếm các bước đi ngược hướng quá 0.5% khung hình
        reverse_steps = sum(1 for s in steps if (s < -0.005 if dx > 0 else s > 0.005))
        if reverse_steps / len(steps) > 0.25:
            return dx_norm, vx_norm, dt, False

        return dx_norm, vx_norm, dt, True
