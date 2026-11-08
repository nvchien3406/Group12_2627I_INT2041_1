from enum import Enum
import numpy as np
from .kinematics import HandKinematics
from .pose import PoseGate


class GestureAction(str, Enum):
    NONE = "NONE"
    SWIPE_LEFT = "SWIPE_LEFT"    # Quẹt sang trái (x giảm)
    SWIPE_RIGHT = "SWIPE_RIGHT"  # Quẹt sang phải (x tăng)


class GestureFSMState(str, Enum):
    IDLE = "IDLE"
    STEADY = "STEADY"
    SWIPING = "SWIPING"
    COOLDOWN = "COOLDOWN"


class GestureFSM:
    """Máy trạng thái hữu hạn (FSM) phân loại cử chỉ vuốt (Swipe) chuyển slide chuẩn công nghiệp.

    - Kháng nhiễu cao (High Noise Immunity): Yêu cầu bàn tay phải ổn định (STEADY) trước khi bứt tốc.
    - Không kích hoạt khi rút tay/hạ tay (Zero Exit Trigger): Chỉ kích hoạt khi tay đang mở và hiện diện.
    - Tiêu chí động học dứt khoát: Đơn điệu, thẳng hướng, biên độ >= 0.90 L_palm, vận tốc >= 3.0 palms/s.
    """

    def __init__(
        self,
        min_dx_norm: float = 0.90,      # Di chuyển tối thiểu 90% chiều dài bàn tay (~14-16cm)
        min_vx_norm: float = 3.00,      # Vận tốc tối thiểu 3.0 palms/giây (dứt khoát)
        cooldown_seconds: float = 0.60, # Khóa chống dội 600ms
        max_lost_frames: int = 2        # Chỉ cho phép nhòe tối đa 2 frames (~66ms)
    ):
        self.min_dx_norm = min_dx_norm
        self.min_vx_norm = min_vx_norm
        self.cooldown_seconds = cooldown_seconds
        self.max_lost_frames = max_lost_frames

        self.state = GestureFSMState.IDLE
        self.kinematics = HandKinematics()
        self.cooldown_until = 0.0
        self.last_action = GestureAction.NONE
        self.lost_frames = 0
        self.steady_frames = 0

    def reset(self):
        self.state = GestureFSMState.IDLE
        self.kinematics.reset()
        self.cooldown_until = 0.0
        self.last_action = GestureAction.NONE
        self.lost_frames = 0
        self.steady_frames = 0

    def update(self, smooth_landmarks: np.ndarray | None, timestamp_sec: float) -> GestureAction:
        """Đánh giá frame hiện tại và trả về cử chỉ kích hoạt (nếu có)."""
        # 1. Trạng thái Cooldown
        if timestamp_sec < self.cooldown_until:
            self.state = GestureFSMState.COOLDOWN
            return GestureAction.NONE

        is_valid_posture = (
            smooth_landmarks is not None and PoseGate.is_valid_gesture_posture(smooth_landmarks)
        )

        # 2. Xử lý khi mất dấu hoặc tư thế không hợp lệ (hạ tay, nắm tay, rời khung hình)
        if not is_valid_posture:
            # Nếu đang trong quá trình chuẩn bị hoặc quẹt, cho phép dung sai tối đa max_lost_frames
            if self.state in (GestureFSMState.STEADY, GestureFSMState.SWIPING) and self.lost_frames < self.max_lost_frames:
                self.lost_frames += 1
                return GestureAction.NONE

            # Nếu đã mất dấu quá giới hạn -> Reset về IDLE
            self.state = GestureFSMState.IDLE
            self.kinematics.reset()
            self.lost_frames = 0
            self.steady_frames = 0
            return GestureAction.NONE

        # 3. Bàn tay hiện diện hợp lệ
        self.lost_frames = 0
        self.kinematics.update(smooth_landmarks, timestamp_sec)

        # Kiểm tra nếu tay đang hạ xuống dưới (rút tay)
        if len(self.kinematics.history) >= 2:
            oldest = self.kinematics.history[0]
            newest = self.kinematics.history[-1]
            dy_down = (newest.center_y - oldest.center_y) / newest.palm_size
            if dy_down > 0.28:
                self.state = GestureFSMState.IDLE
                self.kinematics.reset()
                self.steady_frames = 0
                return GestureAction.NONE

        dx_norm, vx_norm, dt, is_valid_swipe = self.kinematics.analyze_swipe()

        # Kiểm tra trạng thái ổn định ban đầu (STEADY)
        if abs(vx_norm) < 1.8:
            self.steady_frames += 1
            if self.steady_frames >= 2:
                self.state = GestureFSMState.STEADY
        else:
            if self.state == GestureFSMState.STEADY:
                self.state = GestureFSMState.SWIPING

        # 4. Đánh giá điều kiện kích hoạt cử chỉ (Swipe Trigger)
        if self.state in (GestureFSMState.STEADY, GestureFSMState.SWIPING):
            if (
                is_valid_swipe
                and abs(dx_norm) >= self.min_dx_norm
                and abs(vx_norm) >= self.min_vx_norm
            ):
                action = GestureAction.SWIPE_RIGHT if dx_norm > 0 else GestureAction.SWIPE_LEFT

                # Kích hoạt thành công -> Vào COOLDOWN và reset lịch sử
                self.state = GestureFSMState.COOLDOWN
                self.cooldown_until = timestamp_sec + self.cooldown_seconds
                self.last_action = action
                self.kinematics.reset()
                self.lost_frames = 0
                self.steady_frames = 0
                return action

        return GestureAction.NONE
