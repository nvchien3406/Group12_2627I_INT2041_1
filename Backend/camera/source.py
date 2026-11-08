from dataclasses import dataclass
import os
import cv2


class CameraError(RuntimeError):
    pass


@dataclass(frozen=True)
class CameraConfig:
    device_index: int = 0
    width: int = 640
    height: int = 480
    fps: int = 30
    num_hands: int = 2


class CameraSource:
    """Chỉ thread capture gọi open/read/close; luôn chỉ một VideoCapture."""

    def __init__(self, config: CameraConfig):
        self.config = config
        self.cap = None

    def open(self):
        # DirectShow thường phù hợp webcam trên Windows. Đổi bằng biến môi trường
        # HMI_CAMERA_API=MSMF nếu driver máy cần Media Foundation.
        api_name = os.environ.get("HMI_CAMERA_API", "DSHOW" if os.name == "nt" else "ANY")
        api = {"DSHOW": cv2.CAP_DSHOW, "MSMF": cv2.CAP_MSMF}.get(api_name.upper(), cv2.CAP_ANY)
        self.cap = cv2.VideoCapture(self.config.device_index, api)
        if not self.cap.isOpened():
            self.close()
            raise CameraError("Không mở được camera. Đóng Camera/Teams/Zoom hoặc thử camera số khác.")
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.config.width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.config.height)
        self.cap.set(cv2.CAP_PROP_FPS, self.config.fps)
        # Đây là gợi ý; không phải mọi driver đều hỗ trợ.
        self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    def read(self):
        ok, frame = self.cap.read()
        if not ok or frame is None or frame.size == 0:
            raise CameraError("Camera đã mở nhưng không đọc được ảnh. Kiểm tra thiết bị và quyền camera Windows.")
        return frame

    def close(self):
        if self.cap is not None:
            self.cap.release()
            self.cap = None
