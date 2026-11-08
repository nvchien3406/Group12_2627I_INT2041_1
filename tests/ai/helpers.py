"""Tọa độ tay giả lập dùng chung cho kiểm thử AI."""
import numpy as np


def create_dummy_hand(center_x=0.5, center_y=0.5, palm_length=0.15, is_open=True, is_pointing_down=False):
    """Tạo landmarks giả lập (21, 3) đại diện cho một bàn tay."""
    landmarks = np.zeros((21, 3), dtype=np.float32)
    # 0: Wrist
    wrist_y = center_y + palm_length * 0.5
    landmarks[0] = [center_x, wrist_y, 0.0]
    # 9: Middle MCP
    mcp_y = center_y - palm_length * 0.5
    landmarks[9] = [center_x, mcp_y, 0.0]

    # Các khớp khác
    landmarks[5] = [center_x - 0.03, mcp_y, 0.0]
    landmarks[6] = [center_x - 0.03, mcp_y - palm_length * 0.4, 0.0]
    landmarks[10] = [center_x, mcp_y - palm_length * 0.4, 0.0]
    landmarks[13] = [center_x + 0.03, mcp_y, 0.0]
    landmarks[14] = [center_x + 0.03, mcp_y - palm_length * 0.4, 0.0]
    landmarks[17] = [center_x + 0.06, mcp_y, 0.0]
    landmarks[18] = [center_x + 0.06, mcp_y - palm_length * 0.3, 0.0]
    landmarks[2] = [center_x - 0.05, wrist_y - palm_length * 0.2, 0.0]

    if is_pointing_down:
        # Ngón tay chúc thẳng xuống dưới cổ tay (tư thế buông thõng)
        landmarks[8] = [center_x - 0.03, wrist_y + palm_length * 0.8, 0.0]
        landmarks[12] = [center_x, wrist_y + palm_length * 0.9, 0.0]
        landmarks[16] = [center_x + 0.03, wrist_y + palm_length * 0.8, 0.0]
        landmarks[20] = [center_x + 0.06, wrist_y + palm_length * 0.6, 0.0]
        landmarks[4] = [center_x - 0.06, wrist_y + palm_length * 0.4, 0.0]
    elif is_open:
        landmarks[8] = [center_x - 0.03, mcp_y - palm_length * 0.9, 0.0]
        landmarks[12] = [center_x, mcp_y - palm_length * 1.0, 0.0]
        landmarks[16] = [center_x + 0.03, mcp_y - palm_length * 0.9, 0.0]
        landmarks[20] = [center_x + 0.06, mcp_y - palm_length * 0.7, 0.0]
        landmarks[4] = [center_x - 0.09, wrist_y - palm_length * 0.6, 0.0]
    else:
        # Nắm tay
        landmarks[8] = [center_x - 0.03, mcp_y + 0.02, 0.0]
        landmarks[12] = [center_x, mcp_y + 0.02, 0.0]
        landmarks[16] = [center_x + 0.03, mcp_y + 0.02, 0.0]
        landmarks[20] = [center_x + 0.06, mcp_y + 0.02, 0.0]
        landmarks[4] = [center_x - 0.03, wrist_y - 0.02, 0.0]

    return landmarks
