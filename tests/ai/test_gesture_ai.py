import numpy as np
from AI.filters.one_euro import OneEuroFilter3D
from AI.gestures.fsm import GestureAction, GestureFSM, GestureFSMState
from tests.ai.helpers import create_dummy_hand


def test_one_euro_filter_jitter_suppression():
    filt = OneEuroFilter3D(min_cutoff=1.0, beta=0.007)
    base_coords = create_dummy_hand(0.5, 0.5)

    np.random.seed(42)
    filtered_outputs = []
    for i in range(30):
        t = i * (1.0 / 30.0)
        noisy = base_coords + np.random.normal(0, 0.005, size=base_coords.shape).astype(np.float32)
        out = filt.filter(noisy, t)
        if i >= 10:
            filtered_outputs.append(out[8, 0])

    std_filtered = np.std(filtered_outputs)
    assert std_filtered < 0.002, f"Bộ lọc phải giảm rung nhiễu (std={std_filtered})"


def test_gesture_fsm_swipe_right():
    fsm = GestureFSM()
    palm_len = 0.15

    # 1. Hai frame đầu tay đứng yên ổn định (STEADY)
    fsm.update(create_dummy_hand(0.35, 0.5, palm_len), 0.00)
    fsm.update(create_dummy_hand(0.35, 0.5, palm_len), 0.033)
    assert fsm.state == GestureFSMState.STEADY

    # 2. Cú quẹt dứt khoát sang phải: dx = 0.52 - 0.35 = 0.17 (~1.13 L_palm) trong 0.1s
    actions = []
    for t, x in [(0.066, 0.40), (0.10, 0.46), (0.133, 0.52)]:
        act = fsm.update(create_dummy_hand(x, 0.5, palm_len), t)
        if act != GestureAction.NONE:
            actions.append((t, act))

    assert len(actions) == 1
    assert actions[0][1] == GestureAction.SWIPE_RIGHT
    assert fsm.state == GestureFSMState.COOLDOWN
