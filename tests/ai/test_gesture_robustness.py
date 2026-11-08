from AI.gestures.fsm import GestureAction, GestureFSM, GestureFSMState
from AI.gestures.pose import PoseGate
from tests.ai.helpers import create_dummy_hand


def test_pose_gate_open_and_closed():
    open_hand = create_dummy_hand(0.5, 0.5, is_open=True)
    closed_hand = create_dummy_hand(0.5, 0.5, is_open=False)
    down_hand = create_dummy_hand(0.5, 0.5, is_pointing_down=True)

    assert PoseGate.is_in_roi(open_hand)
    assert PoseGate.is_open_palm(open_hand)
    assert PoseGate.is_valid_gesture_posture(open_hand)

    # Nắm tay hoặc buông thõng tay phải bị từ chối
    assert not PoseGate.is_open_palm(closed_hand)
    assert not PoseGate.is_valid_gesture_posture(closed_hand)
    assert not PoseGate.is_open_palm(down_hand)
    assert not PoseGate.is_valid_gesture_posture(down_hand)


def test_gesture_fsm_reject_slow_casual_motion():
    """Chuyển động khua tay chậm chạp khi nói chuyện không được kích hoạt đổi slide."""
    fsm = GestureFSM()
    palm_len = 0.15

    # Tay rê từ từ qua màn hình trong 0.4s (vận tốc thấp ~1.0 palm/s)
    actions = []
    for i in range(12):
        t = i * 0.033
        x = 0.35 + (i / 12) * 0.10
        act = fsm.update(create_dummy_hand(x, 0.5, palm_len), t)
        if act != GestureAction.NONE:
            actions.append((t, act))

    assert len(actions) == 0, f"Chuyển động chậm không được kích hoạt, kết quả: {actions}"


def test_gesture_fsm_reject_hand_drop_or_exit():
    """Hạ tay xuống bàn hoặc rút tay khỏi màn hình tuyệt đối không được kích hoạt đổi slide."""
    fsm = GestureFSM()
    palm_len = 0.15

    # Tay đang mở ở 0.5, 0.5
    fsm.update(create_dummy_hand(0.5, 0.5, palm_len), 0.00)
    fsm.update(create_dummy_hand(0.5, 0.5, palm_len), 0.033)

    # Người dùng hạ tay xuống dưới lệch sang phải (rút tay)
    act1 = fsm.update(create_dummy_hand(0.55, 0.65, palm_len), 0.066)
    act2 = fsm.update(create_dummy_hand(0.60, 0.85, palm_len), 0.10)
    # Tay biến mất khỏi khung hình
    act3 = fsm.update(None, 0.133)

    assert act1 == GestureAction.NONE
    assert act2 == GestureAction.NONE
    assert act3 == GestureAction.NONE
    assert fsm.state == GestureFSMState.IDLE


def test_gesture_fsm_motion_blur_recovery():
    """Vung tay nhanh có 1 frame bị nhòe ở giữa nhưng kết thúc đúng và đủ tiêu chuẩn."""
    fsm = GestureFSM()
    palm_len = 0.15

    # Steady
    fsm.update(create_dummy_hand(0.35, 0.5, palm_len), 0.00)
    fsm.update(create_dummy_hand(0.35, 0.5, palm_len), 0.033)

    # Bắt đầu quẹt
    fsm.update(create_dummy_hand(0.40, 0.5, palm_len), 0.066)

    # 1 frame nhòe ở giữa
    act_blur = fsm.update(None, 0.10)
    assert act_blur == GestureAction.NONE
    assert fsm.lost_frames == 1

    # Tay hiện lại ở đích đến 0.52
    act_recover = fsm.update(create_dummy_hand(0.52, 0.5, palm_len), 0.133)
    assert act_recover == GestureAction.SWIPE_RIGHT
    assert fsm.state == GestureFSMState.COOLDOWN
