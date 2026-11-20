import { CameraClient, checkCameraHealth } from './camera_client.js';

/**
 * Initialize the standalone camera control and gesture monitor window.
 */
function initCameraWindow() {
  const $ = (id) => document.getElementById(id);

  const cameraBadge = $('cameraBadge');
  const cameraPreview = $('cameraPreview');
  const cameraEmpty = $('cameraEmpty');
  const cameraPlaceholder = $('cameraPlaceholder');
  const cameraMessage = $('cameraMessage');
  const cameraButton = $('cameraButton');
  const cameraButtonText = $('cameraButtonText');
  const cameraIndex = $('cameraIndex');
  const handCount = $('handCount');
  const cameraFps = $('cameraFps');
  const processingTime = $('processingTime');
  const handDetails = $('handDetails');
  const gestureOverlay = $('gestureOverlay');
  const gestureOverlayText = $('gestureOverlayText');
  const gestureOverlayIconWrap = $('gestureOverlayIconWrap');
  const gestureCard = $('gestureCard');
  const gestureCardTitle = $('gestureCardTitle');
  const gestureCardDesc = $('gestureCardDesc');
  const gestureCardIconWrap = $('gestureCardIconWrap');
  const gestureSeq = $('gestureSeq');
  const connectionBadge = $('connectionBadge');
  const connectionText = $('connectionText');

  const channel = new BroadcastChannel('gesture_channel');

  let cameraBusy = false;
  let cameraState = 'stopped';
  let previewSession = null;
  let overlayTimer = null;

  const BADGE_CLASSES = {
    running: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    starting: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    error: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    default: 'bg-slate-800 text-slate-400 border-slate-700',
  };

  const STATE_LABELS = {
    stopped: 'Đã tắt',
    starting: 'Đang mở',
    running: 'Đang chạy',
    stopping: 'Đang tắt',
    error: 'Có lỗi',
  };

  function syncButtonState() {
    cameraButton.disabled = cameraBusy;
    cameraButtonText.textContent = cameraBusy
      ? 'Đang xử lý...'
      : camera.sessionId
        ? 'Tắt camera'
        : 'Bật camera';
    cameraButton.className =
      'w-full py-2.5 px-4 rounded-xl font-semibold text-xs text-white transition flex items-center justify-center space-x-2 shadow-lg ' +
      (cameraBusy ? 'opacity-60 cursor-not-allowed ' : '') +
      (camera.sessionId
        ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20'
        : 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/20');
    cameraIndex.disabled = cameraBusy || !!camera.sessionId;
  }

  function showCameraError(message) {
    cameraBadge.textContent = 'Có lỗi';
    cameraBadge.className = `px-2 py-0.5 rounded-full text-[10px] font-semibold border ${BADGE_CLASSES.error}`;
    cameraMessage.textContent = message || 'Lỗi điều khiển camera.';
    cameraMessage.className = 'text-center text-rose-400 text-[11px] leading-relaxed min-h-[16px]';
    if (['stopped', 'error'].includes(cameraState)) {
      cameraPlaceholder.textContent = 'Chưa kết nối được camera';
    }
  }

  function broadcastToMain(payload) {
    channel.postMessage(payload);
    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage(payload, '*');
      } catch (_) {}
    }
  }

  function updateStatus(data) {
    cameraState = data.state;

    cameraBadge.textContent = STATE_LABELS[data.state] || data.state;
    const badgeVariant = BADGE_CLASSES[data.state] || BADGE_CLASSES.default;
    cameraBadge.className = `px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badgeVariant}`;

    cameraMessage.className =
      data.state === 'error'
        ? 'text-center text-rose-400 text-[11px] leading-relaxed min-h-[16px]'
        : 'text-center text-slate-400 text-[11px] leading-relaxed min-h-[16px]';

    if (data.state === 'running') {
      if (camera.sessionId && previewSession !== camera.sessionId) {
        previewSession = camera.sessionId;
        cameraPreview.src = camera.previewUrl();
      }
      cameraEmpty.classList.add('hidden');
      cameraPreview.classList.remove('hidden');
      cameraMessage.textContent = data.hand_count
        ? `Đã nhận diện ${data.hand_count} bàn tay · hình soi gương`
        : 'Đang tìm bàn tay. Hãy đưa tay vào khung hình.';
    } else if (data.state === 'starting') {
      cameraPlaceholder.textContent = 'Đang mở camera và nạp MediaPipe...';
      cameraMessage.textContent = 'Lần bật đầu tiên có thể mất vài giây.';
    } else if (['stopped', 'error'].includes(data.state)) {
      cameraPreview.removeAttribute('src');
      cameraPreview.classList.add('hidden');
      cameraEmpty.classList.remove('hidden');
      previewSession = null;
      cameraPlaceholder.textContent =
        data.state === 'error' ? 'Chưa kết nối được camera' : 'Camera hiện đang tắt';
      cameraMessage.textContent =
        data.error || 'Chọn thiết bị rồi bấm Bật camera để nhận diện.';
    }

    handCount.textContent = data.state === 'running' ? (data.hand_count ?? '0') : '—';
    cameraFps.textContent = data.fps > 0 ? data.fps.toFixed(1) : '—';
    processingTime.textContent = data.processing_ms > 0 ? data.processing_ms.toFixed(0) : '—';

    const hands = data.hands || [];
    if (hands.length === 0) {
      handDetails.innerHTML = `<div class="text-slate-500 italic">${
        data.state === 'running'
          ? 'Chưa phát hiện bàn tay nào trong khung hình.'
          : 'Bật camera để theo dõi khớp tay.'
      }</div>`;
    } else {
      handDetails.innerHTML = hands
        .map(
          (h, i) => `
          <div class="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800/80">
            <span class="font-medium text-slate-200">Bàn tay ${i + 1}</span>
            <span class="text-emerald-400 font-mono text-[10px]">${h.landmarks?.length || 21} khớp</span>
          </div>
        `
        )
        .join('');
    }

    syncButtonState();

    broadcastToMain({
      type: 'CAMERA_STATUS',
      state: data.state,
      sessionId: camera.sessionId,
      handCount: data.hand_count || 0,
    });
  }

  function handleGesture(data) {
    if (!data || !data.gesture) return;
    const isNext = data.gesture === 'SWIPE_RIGHT';
    const isPrev = data.gesture === 'SWIPE_LEFT';

    const title = isNext ? '👉 Trang tiếp theo' : isPrev ? '👈 Trang trước' : data.gesture;
    const desc = `${data.gesture} DETECTED`;
    const iconName = isNext ? 'arrow-right' : isPrev ? 'arrow-left' : 'hand';

    gestureCardTitle.textContent = title;
    gestureCardDesc.textContent = desc;
    gestureSeq.textContent = `Seq: #${data.sequence || '0'}`;

    gestureCard.classList.remove('border-slate-800');
    gestureCard.classList.add(
      isNext ? 'border-blue-500/60' : 'border-purple-500/60',
      'gesture-flash'
    );
    gestureCardIconWrap.className =
      'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ' +
      (isNext ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400');
    gestureCardIconWrap.innerHTML = `<i data-lucide="${iconName}" class="w-5 h-5"></i>`;

    gestureOverlayText.textContent = isNext
      ? 'SWIPE RIGHT 👉'
      : isPrev
        ? 'SWIPE LEFT 👈'
        : data.gesture;
    gestureOverlayIconWrap.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4"></i>`;
    gestureOverlay.classList.remove('opacity-0', '-translate-y-2');
    gestureOverlay.classList.add('opacity-100', 'translate-y-0');

    if (window.lucide) {
      window.lucide.createIcons();
    }

    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => {
      gestureOverlay.classList.add('opacity-0', '-translate-y-2');
      gestureOverlay.classList.remove('opacity-100', 'translate-y-0');
      gestureCard.classList.remove('border-blue-500/60', 'border-purple-500/60', 'gesture-flash');
      gestureCard.classList.add('border-slate-800');
    }, 1200);

    const gesturePayload = {
      type: 'GESTURE',
      gesture: data.gesture,
      sequence: data.sequence,
      sessionId: camera.sessionId,
    };
    broadcastToMain(gesturePayload);

    if (window.opener && !window.opener.closed) {
      try {
        if (typeof window.opener.handleGesture === 'function') {
          window.opener.handleGesture(gesturePayload);
        }
      } catch (_) {}
    }
  }

  const camera = new CameraClient(
    updateStatus,
    (err) => showCameraError(err),
    handleGesture
  );

  async function verifyHealth() {
    try {
      const health = await checkCameraHealth(5000);
      if (cameraState === 'stopped' && !camera.sessionId) {
        if (health.ok && health.model_ready) {
          cameraMessage.className =
            'text-center text-slate-400 text-[11px] leading-relaxed min-h-[16px]';
          cameraMessage.textContent =
            'Dịch vụ camera sẵn sàng. Chọn thiết bị rồi bấm Bật camera để nhận diện.';
        } else if (health.ok && !health.model_ready) {
          showCameraError(
            'Thiếu model nhận diện bàn tay. Chạy lại install.bat rồi khởi động lại server.'
          );
        }
      }
    } catch (_) {
      if (cameraState === 'stopped' && !camera.sessionId) {
        cameraBadge.textContent = 'Chưa kết nối';
        cameraBadge.className = `px-2 py-0.5 rounded-full text-[10px] font-semibold border ${BADGE_CLASSES.starting}`;
        cameraMessage.className =
          'text-center text-amber-400 text-[11px] leading-relaxed min-h-[16px]';
        cameraMessage.textContent =
          'Chưa kết nối được dịch vụ camera (port 8000). Hãy chạy run.py rồi bấm Bật camera.';
      }
    }
  }

  cameraButton.addEventListener('click', async () => {
    if (cameraBusy) return;
    cameraBusy = true;
    syncButtonState();

    try {
      if (camera.sessionId) {
        await camera.stop();
      } else {
        const session = await camera.start(Number(cameraIndex.value));
        previewSession = session;
        cameraPreview.src = camera.previewUrl(session);
      }
    } catch (err) {
      showCameraError(err.message || 'Lỗi điều khiển camera.');
    } finally {
      cameraBusy = false;
      syncButtonState();
    }
  });

  cameraPreview.addEventListener('error', () => {
    if (previewSession && camera.sessionId === previewSession && cameraState === 'running') {
      cameraMessage.textContent = 'Luồng xem trước camera bị ngắt. Hãy tắt rồi bật lại.';
    }
  });

  function checkOpenerConnection() {
    const isConnected = !!(window.opener && !window.opener.closed);
    if (isConnected) {
      connectionBadge.className =
        'px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center space-x-1';
      connectionText.textContent = 'Đã kết nối Slide';
    } else {
      connectionBadge.className =
        'px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-800 text-slate-400 border border-slate-700 flex items-center space-x-1';
      connectionText.textContent = 'Cửa sổ độc lập';
    }
  }

  setInterval(checkOpenerConnection, 2000);
  checkOpenerConnection();
  verifyHealth();
  syncButtonState();

  window.addEventListener('pagehide', () => camera.beaconStop());
  window.addEventListener('beforeunload', () => camera.beaconStop());

  window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'START_CAMERA' && !camera.sessionId) {
      cameraButton.click();
    } else if (e.data.type === 'STOP_CAMERA' && camera.sessionId) {
      cameraButton.click();
    }
  });

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCameraWindow);
} else {
  initCameraWindow();
}
