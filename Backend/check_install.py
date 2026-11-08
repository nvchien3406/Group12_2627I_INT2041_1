"""Kiểm tra thư viện và suy luận thật; không bật webcam."""
import sys
import numpy as np
from AI.hand_detector import HandDetector


def main():
    import fastapi
    import uvicorn
    import mediapipe
    import cv2
    print("Python", sys.version.split()[0])
    print("MediaPipe", mediapipe.__version__, "OpenCV", cv2.__version__)
    detector = HandDetector()
    try:
        result = detector.detect(np.zeros((240, 320, 3), dtype=np.uint8), 0)
        assert result == [], "Blank frame should contain no hands"
    finally:
        detector.close()
    print("OK: model chay duoc. Webcam chua duoc bat. Tiep theo chay run.bat.")


if __name__ == "__main__":
    main()
