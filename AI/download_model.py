"""Khôi phục model chính thức nếu file đi kèm bị thiếu hoặc hỏng."""
import hashlib
from pathlib import Path
import urllib.request

URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
SHA256 = "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1"
TARGET = Path(__file__).resolve().parent / "models" / "hand_landmarker.task"


def ensure_model():
    if TARGET.exists() and hashlib.sha256(TARGET.read_bytes()).hexdigest() == SHA256:
        print("Model da san sang.")
        return
    print("Dang tai model Hand Landmarker chinh thuc (khoang 8 MB)...")
    with urllib.request.urlopen(URL, timeout=90) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise RuntimeError("Model khong dung checksum. Khong su dung file tai ve.")
    TARGET.parent.mkdir(exist_ok=True)
    temporary = TARGET.with_suffix(".partial")
    temporary.write_bytes(data)
    temporary.replace(TARGET)
    print("Da tai va kiem tra model.")


if __name__ == "__main__":
    ensure_model()
