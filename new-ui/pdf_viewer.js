import * as pdfjs from '/static/vendor/pdfjs/build/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = '/static/vendor/pdfjs/build/pdf.worker.mjs';

/**
 * Single-page responsive PDF.js rendering engine with cancellation and
 * rapid-navigation queueing.
 */
export class PdfViewer {
  constructor(stage, host) {
    this.stage = stage;
    this.host = host;
    this.document = null;
    this.loadingTask = null;
    this.currentPage = 0;
    this.totalPages = 0;
    this.renderTask = null;
    this.generation = 0;
    this.busy = false;
    this.mode = 'auto';
    this.scale = 1;
    this.customScale = 1;
    this.rotation = 0;
    this.effectiveMode = 'auto';
    this.pendingRefresh = false;
    this.pendingPage = null;
  }

  async close() {
    this.generation++;
    this.pendingPage = null;
    this.pendingRefresh = false;
    if (this.renderTask) {
      try {
        this.renderTask.cancel();
      } catch (_) {}
      await this.renderTask.promise.catch(() => {});
    }
    if (this.loadingTask) {
      try {
        await this.loadingTask.destroy();
      } catch (_) {}
    }
    this.document = null;
    this.loadingTask = null;
    this.renderTask = null;
    this.currentPage = 0;
    this.totalPages = 0;
    this.busy = false;
    this.host.replaceChildren();
  }

  async open(source) {
    await this.close();
    this.mode = 'auto';
    this.customScale = 1;
    this.rotation = 0;
    const generation = this.generation;

    const docParams = {
      cMapUrl: '/static/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/static/vendor/pdfjs/standard_fonts/',
      wasmUrl: '/static/vendor/pdfjs/wasm/',
      isEvalSupported: false,
    };

    if (typeof source === 'string') {
      docParams.url = source;
    } else if (source instanceof Blob || source instanceof File) {
      docParams.data = new Uint8Array(await source.arrayBuffer());
    } else if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
      docParams.data = source instanceof Uint8Array ? source : new Uint8Array(source);
    }

    let needsPassword = false;
    this.loadingTask = pdfjs.getDocument(docParams);
    this.loadingTask.onPassword = () => {
      needsPassword = true;
      this.loadingTask.destroy().catch(() => {});
    };

    try {
      const doc = await this.loadingTask.promise;
      if (generation !== this.generation) return;
      this.document = doc;
      this.totalPages = doc.numPages;
      await this.renderPage(1);
    } catch (err) {
      await this.close();
      throw new Error(
        needsPassword ? 'PDF có mật khẩu bảo vệ.' : `Không đọc được PDF: ${err.message}`
      );
    }
  }

  async renderPage(number) {
    if (!this.document || number < 1 || number > this.totalPages) return;
    if (this.busy) {
      this.pendingPage = number;
      return;
    }
    this.busy = true;
    const generation = this.generation;

    try {
      const page = await this.document.getPage(number);
      const original = page.getViewport({ scale: 1, rotation: this.rotation });
      const padding = getComputedStyle(this.stage);
      const padX = parseFloat(padding.paddingLeft || 0) + parseFloat(padding.paddingRight || 0);
      const padY = parseFloat(padding.paddingTop || 0) + parseFloat(padding.paddingBottom || 0);
      const width = Math.max(1, this.stage.clientWidth - padX);
      const height = Math.max(1, this.stage.clientHeight - padY);
      const fit = Math.min(width / original.width, height / original.height);

      const effectiveMode =
        this.mode === 'auto'
          ? original.height > original.width
            ? 'width'
            : 'page'
          : this.mode;
      const scale =
        effectiveMode === 'custom'
          ? this.customScale
          : effectiveMode === 'width'
            ? width / original.width
            : fit;
      const viewport = page.getViewport({ scale, rotation: this.rotation });

      const ratio = Math.min(
        window.devicePixelRatio || 1,
        2,
        8192 / viewport.width,
        8192 / viewport.height,
        Math.sqrt(16000000 / (viewport.width * viewport.height))
      );

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${Math.ceil(viewport.width)}px`;
      canvas.style.height = `${Math.ceil(viewport.height)}px`;
      canvas.className = 'shadow-2xl rounded-lg bg-white block';

      this.renderTask = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: [ratio, 0, 0, ratio, 0, 0],
      });
      await this.renderTask.promise;

      if (generation === this.generation) {
        this.host.replaceChildren(canvas);
        const changedPage = this.currentPage !== number;
        this.currentPage = number;
        this.scale = scale;
        this.effectiveMode = effectiveMode;
        if (changedPage) this.stage.scrollTo(0, 0);
      }
    } finally {
      if (generation === this.generation) {
        this.renderTask = null;
        this.busy = false;
        if (this.pendingPage !== null) {
          const queuedPage = this.pendingPage;
          this.pendingPage = null;
          this.pendingRefresh = false;
          await this.renderPage(queuedPage);
        } else if (this.pendingRefresh) {
          this.pendingRefresh = false;
          await this.renderPage(this.currentPage);
        }
      }
    }
  }

  async refresh() {
    if (!this.document) return;
    if (this.busy) {
      this.pendingRefresh = true;
      return;
    }
    await this.renderPage(this.currentPage);
  }
}

/**
 * Coordinates the PDF viewer modal UI, presentation mode, keyboard shortcuts,
 * camera companion window synchronization, and gesture navigation.
 */
export class PdfViewerController {
  constructor({ onNotify } = {}) {
    this.notify = typeof onNotify === 'function' ? onNotify : () => {};

    const $ = (id) => document.getElementById(id);
    this.pdfViewerModal = $('pdfViewerModal');
    this.pdfViewerHeader = $('pdfViewerHeader');
    this.pdfFileName = $('fileName');
    this.pdfStatusText = $('pdfStatus');
    this.openCameraBtn = $('openCameraBtn');
    this.cameraStatusDot = $('cameraStatusDot');
    this.pdfRotate = $('pdfRotate');
    this.pdfDownloadBtn = $('pdfDownloadBtn');
    this.closePdfModalBtn = $('closePdfModalBtn');
    this.pdfStage = $('pdfStage');
    this.canvasHost = $('canvasHost');
    this.pdfEmpty = $('pdfEmpty');
    this.pdfLoadingOverlay = $('pdfLoadingOverlay');
    this.pdfLoadingText = $('pdfLoadingText');
    this.viewModeSelect = $('viewMode');
    this.zoomOutBtn = $('zoomOut');
    this.zoomLevelText = $('zoomLevel');
    this.zoomInBtn = $('zoomIn');
    this.presentationButton = $('presentationButton');
    this.presentationButtonText = $('presentationButtonText');
    this.viewHintText = $('viewHint');
    this.documentHintText = $('documentHint');
    this.previousPageBtn = $('previousPage');
    this.pageCounterText = $('pageCounter');
    this.nextPageBtn = $('nextPage');

    this.gestureHud = $('gestureHud');
    this.gestureHudIconContainer = $('gestureHudIconContainer');
    this.gestureHudText = $('gestureHudText');
    this.gestureHudSubtext = $('gestureHudSubtext');

    this.viewer = new PdfViewer(this.pdfStage, this.canvasHost);

    this.gestureHudTimer = null;
    this.presentationBusy = false;
    this.gestureWs = null;
    this.lastGestureSequence = 0;
    this.lastGestureSessionId = null;
    this.cameraWindow = null;
    this.resizeTimer = null;
    this.gestureChannel = new BroadcastChannel('gesture_channel');

    this._bindEvents();
    this._initResizeObserver();
    this._initGestureChannels();
    window.handleGesture = (event) => this.handleGesture(event);
  }

  _bindEvents() {
    this.closePdfModalBtn.addEventListener('click', () => this.close());
    this.presentationButton.addEventListener('click', () =>
      this.setPresentation(!document.body.classList.contains('presentation-mode'))
    );
    this.openCameraBtn.addEventListener('click', () => this.openCameraWindow());
    this.previousPageBtn.addEventListener('click', () => this.navigate(-1));
    this.nextPageBtn.addEventListener('click', () => this.navigate(1));
    this.viewModeSelect.addEventListener('change', (e) => this.changeView(e.target.value));
    this.zoomInBtn.addEventListener('click', () =>
      this.changeView('custom', this.viewer.scale * 1.2)
    );
    this.zoomOutBtn.addEventListener('click', () =>
      this.changeView('custom', this.viewer.scale / 1.2)
    );
    this.pdfRotate.addEventListener('click', async () => {
      if (!this.viewer.document || this.viewer.busy) return;
      this.viewer.rotation = (this.viewer.rotation + 90) % 360;
      await this.viewer.refresh();
      this.updateControls();
    });

    window.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (this.pdfViewerModal.classList.contains('hidden')) return;

      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        this.navigate(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        this.navigate(-1);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        this.changeView('custom', this.viewer.scale * 1.2);
      } else if (e.key === '-') {
        e.preventDefault();
        this.changeView('custom', this.viewer.scale / 1.2);
      } else if (e.key === 'Escape') {
        if (document.body.classList.contains('presentation-mode')) {
          e.preventDefault();
          this.setPresentation(false);
        } else {
          this.close();
        }
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        this.setPresentation(!document.body.classList.contains('presentation-mode'));
      }
    });

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && document.body.classList.contains('presentation-mode')) {
        this.setPresentation(false);
      }
    });
  }

  _initResizeObserver() {
    const observer = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(async () => {
        if (!this.viewer.document) return;
        try {
          await this.viewer.refresh();
        } catch (_) {}
        finally {
          this.updateControls();
        }
      }, 100);
    });
    observer.observe(this.pdfStage);
  }

  _initGestureChannels() {
    this.gestureChannel.onmessage = (e) => {
      const data = e.data;
      if (!data) return;
      if (data.type === 'GESTURE') {
        this.handleGesture(data);
      } else if (data.type === 'CAMERA_STATUS') {
        this.updateCameraIndicator(data.state, data.sessionId);
      }
    };

    window.addEventListener('message', (e) => {
      const data = e.data;
      if (!data) return;
      if (data.type === 'GESTURE') {
        this.handleGesture(data);
      } else if (data.type === 'CAMERA_STATUS') {
        this.updateCameraIndicator(data.state, data.sessionId);
      }
    });

    this.connectGlobalGestureWebSocket();
  }

  connectGlobalGestureWebSocket() {
    if (this.gestureWs) {
      try {
        this.gestureWs.close();
      } catch (_) {}
      this.gestureWs = null;
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws/gesture`;

    try {
      const ws = new WebSocket(wsUrl);
      this.gestureWs = ws;
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.gesture) this.handleGesture(data);
        } catch (_) {}
      };
      ws.onclose = () => {
        this.gestureWs = null;
        setTimeout(() => this.connectGlobalGestureWebSocket(), 4000);
      };
    } catch (_) {
      setTimeout(() => this.connectGlobalGestureWebSocket(), 4000);
    }
  }

  updateControls() {
    const loaded = this.viewer.currentPage > 0;
    const blocked = !loaded || this.viewer.busy;

    this.viewModeSelect.disabled = blocked;
    this.zoomOutBtn.disabled = blocked || this.viewer.scale <= 0.25;
    this.zoomInBtn.disabled = blocked || this.viewer.scale >= 3;
    this.presentationButton.disabled =
      blocked && !document.body.classList.contains('presentation-mode');

    this.viewModeSelect.value = this.viewer.mode;
    this.zoomLevelText.textContent = loaded ? `${Math.round(this.viewer.scale * 100)}%` : '—';

    this.viewHintText.textContent = !loaded
      ? 'Mở PDF để chọn cách hiển thị.'
      : this.viewer.effectiveMode === 'width'
        ? 'Vừa chiều rộng · Cuộn dọc để đọc hết trang; ← → hoặc gạt tay để đổi trang.'
        : this.viewer.effectiveMode === 'custom'
          ? 'Thu/phóng tùy chỉnh · Cuộn để xem phần ngoài khung.'
          : 'Vừa toàn bộ trang · ← → hoặc gạt tay để đổi slide.';

    this.previousPageBtn.disabled = blocked || this.viewer.currentPage <= 1;
    this.nextPageBtn.disabled = blocked || this.viewer.currentPage >= this.viewer.totalPages;
    this.pageCounterText.textContent = loaded
      ? `${this.viewer.currentPage} / ${this.viewer.totalPages}`
      : '— / —';
    this.pdfStatusText.textContent = loaded ? `${this.viewer.totalPages} trang` : 'Chưa có tài liệu';
  }

  async navigate(delta) {
    if (!this.viewer.document) return;
    const basePage = this.viewer.pendingPage ?? this.viewer.currentPage;
    const targetPage = Math.max(1, Math.min(this.viewer.totalPages, basePage + delta));
    if (targetPage === basePage && !this.viewer.busy) return;
    try {
      const job = this.viewer.renderPage(targetPage);
      this.updateControls();
      await job;
    } catch (err) {
      this.notify(`Không hiển thị được trang: ${err.message}`, 'warning');
    } finally {
      this.updateControls();
    }
  }

  async changeView(mode, scale = this.viewer.scale) {
    if (!this.viewer.document || this.viewer.busy) return;
    this.viewer.mode = mode;
    if (mode === 'custom') {
      this.viewer.customScale = Math.min(3, Math.max(0.25, scale));
    }
    try {
      const job = this.viewer.refresh();
      this.updateControls();
      await job;
      this.pdfStage.scrollTo(0, 0);
    } catch (err) {
      this.notify(`Không thay đổi được hiển thị: ${err.message}`, 'warning');
    } finally {
      this.updateControls();
    }
  }

  async setPresentation(enabled) {
    if (this.presentationBusy) return;
    this.presentationBusy = true;
    document.body.classList.toggle('presentation-mode', enabled);
    this.presentationButtonText.textContent = enabled ? 'Thoát' : 'Trình chiếu';
    this.presentationButton.setAttribute('aria-pressed', String(enabled));

    try {
      if (enabled) {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen().catch(() => {});
        }
        this.notify('Chế độ trình chiếu: Bật (F / Esc để thoát, ← / → đổi slide)');
      } else if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
    } catch (_) {}
    finally {
      this.presentationBusy = false;
      this.updateControls();
      setTimeout(() => this.viewer.refresh(), 120);
    }
  }

  async open(fileName, fullPath) {
    this.pdfFileName.textContent = fileName;
    this.pdfStatusText.textContent = 'Đang đọc PDF…';
    this.pdfLoadingText.textContent = 'Đang tải tài liệu PDF...';
    this.pdfDownloadBtn.href = `/api/download?path=${encodeURIComponent(fullPath)}`;
    this.pdfDownloadBtn.setAttribute('download', fileName);

    this.pdfViewerModal.classList.remove('hidden');
    this.pdfLoadingOverlay.classList.remove('hidden');
    this.pdfEmpty.classList.add('hidden');

    try {
      const pdfUrl = `/api/view?path=${encodeURIComponent(fullPath)}`;
      await this.viewer.open(pdfUrl);
      this.pdfEmpty.classList.add('hidden');
      this.pdfLoadingOverlay.classList.add('hidden');
    } catch (err) {
      console.error('PDF Load Error:', err);
      this.pdfLoadingOverlay.classList.add('hidden');
      if (!this.viewer.document) {
        this.pdfEmpty.classList.remove('hidden');
        this.pdfFileName.textContent = 'Không đọc được tài liệu';
        this.pdfStatusText.textContent = 'Lỗi nạp file';
      }
      this.notify(err.message || 'Lỗi đọc file PDF.', 'warning');
    } finally {
      this.updateControls();
      if (window.lucide) window.lucide.createIcons();
    }
  }

  async close() {
    if (document.body.classList.contains('presentation-mode')) {
      await this.setPresentation(false);
    }
    this.pdfViewerModal.classList.add('hidden');
    await this.viewer.close();
    this.pdfEmpty.classList.remove('hidden');
    this.updateControls();
  }

  showGestureFeedback(message, gesture = null) {
    if (!this.gestureHud) return;

    const isNext = gesture === 'SWIPE_RIGHT' || message.includes('tiếp theo');
    const isPrev = gesture === 'SWIPE_LEFT' || message.includes('trước');
    const iconName = isNext ? 'arrow-right' : isPrev ? 'arrow-left' : 'hand';

    this.gestureHudText.textContent = isNext
      ? 'Trang tiếp theo'
      : isPrev
        ? 'Trang trước'
        : message;
    this.gestureHudSubtext.textContent = gesture ? `${gesture} DETECTED` : message;

    this.gestureHudIconContainer.className =
      'p-2 rounded-full flex items-center justify-center ' +
      (isNext ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400');
    this.gestureHudIconContainer.innerHTML = `<i data-lucide="${iconName}" class="w-6 h-6 animate-pulse"></i>`;

    if (window.lucide) {
      window.lucide.createIcons();
    }

    this.gestureHud.classList.remove('hidden');
    this.gestureHud.classList.add('gesture-hud-active');

    clearTimeout(this.gestureHudTimer);
    this.gestureHudTimer = setTimeout(() => {
      this.gestureHud.classList.add('hidden');
      this.gestureHud.classList.remove('gesture-hud-active');
    }, 1200);
  }

  handleGesture(event) {
    if (!this.viewer.document || !event || !event.gesture) return;
    if (event.sessionId && event.sessionId !== this.lastGestureSessionId) {
      this.lastGestureSessionId = event.sessionId;
      this.lastGestureSequence = 0;
    }
    if (event.sequence && event.sequence <= this.lastGestureSequence) return;
    if (event.sequence) this.lastGestureSequence = event.sequence;

    if (event.gesture === 'SWIPE_RIGHT') {
      this.showGestureFeedback('👉 Trang tiếp theo (Swipe Right)', 'SWIPE_RIGHT');
      this.navigate(1);
    } else if (event.gesture === 'SWIPE_LEFT') {
      this.showGestureFeedback('👈 Trang trước (Swipe Left)', 'SWIPE_LEFT');
      this.navigate(-1);
    }
  }

  openCameraWindow() {
    if (this.cameraWindow && !this.cameraWindow.closed) {
      this.cameraWindow.focus();
      return this.cameraWindow;
    }
    const width = 450;
    const height = 740;
    const left = Math.max(10, window.screen.availWidth - width - 20);
    const top = 40;
    this.cameraWindow = window.open(
      'camera.html',
      'GestureSlideCamera',
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes,status=no`
    );
    return this.cameraWindow;
  }

  updateCameraIndicator(cameraState, sessionId = null) {
    if (
      cameraState === 'stopped' ||
      cameraState === 'starting' ||
      (sessionId && sessionId !== this.lastGestureSessionId)
    ) {
      this.lastGestureSequence = 0;
      this.lastGestureSessionId = sessionId || null;
    }
    if (!this.cameraStatusDot) return;
    if (cameraState === 'running') {
      this.cameraStatusDot.className =
        'w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block';
      this.cameraStatusDot.title = 'Camera đang chạy';
    } else if (cameraState === 'starting') {
      this.cameraStatusDot.className =
        'w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block';
      this.cameraStatusDot.title = 'Camera đang mở';
    } else {
      this.cameraStatusDot.className = 'w-2 h-2 rounded-full bg-slate-500 inline-block';
      this.cameraStatusDot.title = 'Camera đã tắt';
    }
  }
}
