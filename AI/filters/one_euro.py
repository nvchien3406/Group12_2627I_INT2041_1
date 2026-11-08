import numpy as np


class OneEuroFilter3D:
    """Bộ lọc thích ứng 1€ (One-Euro Filter) cho mảng tọa độ 3D (shape: N x 3).

    Triệt tiêu rung giật (jitter) khi đứng yên và giữ độ trễ cực thấp (zero-lag) khi chuyển động nhanh.
    """

    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.007, d_cutoff: float = 1.0):
        self.min_cutoff = float(min_cutoff)
        self.beta = float(beta)
        self.d_cutoff = float(d_cutoff)
        self.x_prev = None
        self.dx_prev = None
        self.t_prev = None

    def reset(self):
        self.x_prev = None
        self.dx_prev = None
        self.t_prev = None

    def filter(self, x: np.ndarray, timestamp_sec: float) -> np.ndarray:
        """Lọc mảng tọa độ x (dạng np.ndarray (N, 3)) theo timestamp (giây)."""
        x = np.asarray(x, dtype=np.float32)

        if self.x_prev is None:
            self.x_prev = x.copy()
            self.dx_prev = np.zeros_like(x)
            self.t_prev = float(timestamp_sec)
            return x

        dt = max(float(timestamp_sec) - self.t_prev, 1e-4)

        # 1. Ước lượng và làm mịn vi phân vận tốc
        dx = (x - self.x_prev) / dt
        alpha_d = self._smoothing_factor(dt, self.d_cutoff)
        dx_hat = alpha_d * dx + (1.0 - alpha_d) * self.dx_prev

        # 2. Tính tần số cắt động f_c dựa trên tốc độ di chuyển
        # Norm theo trục không gian (axis=-1)
        speed = np.linalg.norm(dx_hat, axis=-1, keepdims=True)
        cutoff = self.min_cutoff + self.beta * speed
        alpha = self._smoothing_factor(dt, cutoff)

        # 3. Làm mịn vị trí
        x_hat = alpha * x + (1.0 - alpha) * self.x_prev

        self.x_prev = x_hat
        self.dx_prev = dx_hat
        self.t_prev = float(timestamp_sec)
        return x_hat

    @staticmethod
    def _smoothing_factor(dt: float, cutoff):
        r = 2.0 * np.pi * cutoff * dt
        return r / (r + 1.0)
