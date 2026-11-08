import numpy as np


class PoseGate:
    """Kiểm tra hình học tư thế bàn tay (Hand Pose) và Vùng tương tác (ROI)."""

    @staticmethod
    def is_in_roi(landmarks: np.ndarray, roi=(0.08, 0.08, 0.92, 0.92)) -> bool:
        """Kiểm tra tâm bàn tay có nằm trong Active ROI không."""
        center_x = (landmarks[0, 0] + landmarks[9, 0]) * 0.5
        center_y = (landmarks[0, 1] + landmarks[9, 1]) * 0.5
        x_min, y_min, x_max, y_max = roi
        return x_min <= center_x <= x_max and y_min <= center_y <= y_max

    @staticmethod
    def check_finger_extensions(landmarks: np.ndarray) -> dict[str, bool]:
        """Xác định trạng thái duỗi/gập của từng ngón tay.

        So sánh khoảng cách từ đầu ngón (TIP) tới cổ tay (WRIST - 0) với khớp giữa (PIP).
        """
        wrist = landmarks[0]

        # Các ngón: (tên, tip_idx, pip_idx, mcp_idx)
        fingers = [
            ("index", 8, 6, 5),
            ("middle", 12, 10, 9),
            ("ring", 16, 14, 13),
            ("pinky", 20, 18, 17),
        ]

        extensions = {}
        for name, tip_idx, pip_idx, mcp_idx in fingers:
            d_tip = np.linalg.norm(landmarks[tip_idx] - wrist)
            d_pip = np.linalg.norm(landmarks[pip_idx] - wrist)
            extensions[name] = bool(d_tip > 1.20 * d_pip)

        # Ngón cái (Thumb): đo khoảng cách tip (4) so với mcp (2) tới pinky_mcp (17)
        pinky_mcp = landmarks[17]
        d_thumb_tip = np.linalg.norm(landmarks[4] - pinky_mcp)
        d_thumb_mcp = np.linalg.norm(landmarks[2] - pinky_mcp)
        extensions["thumb"] = bool(d_thumb_tip > 1.18 * d_thumb_mcp)

        return extensions

    @classmethod
    def is_open_palm(cls, landmarks: np.ndarray) -> bool:
        """Bàn tay mở/xòe rõ ràng:

        - Ít nhất 4 ngón tay duỗi (bắt buộc có ngón trỏ và ngón giữa).
        - Hướng bàn tay: Các đầu ngón tay phải hướng lên trên (hoặc ngang), không chúc thẳng xuống đất.
        """
        ext = cls.check_finger_extensions(landmarks)
        extended_count = sum(ext.values())
        if extended_count < 4 or not (ext["index"] and ext["middle"]):
            return False

        # Kiểm tra ngón tay không bị chúc xuống dưới cổ tay (tránh tư thế buông thõng tay)
        wrist_y = landmarks[0, 1]
        tips_y_mean = np.mean([landmarks[8, 1], landmarks[12, 1], landmarks[16, 1]])
        if tips_y_mean > wrist_y + 0.05:
            return False

        return True

    @classmethod
    def is_valid_gesture_posture(cls, landmarks: np.ndarray) -> bool:
        """Tư thế hợp lệ để thực hiện cử chỉ đổi slide: Xòe bàn tay rõ ràng trong vùng ROI."""
        return cls.is_in_roi(landmarks) and cls.is_open_palm(landmarks)
