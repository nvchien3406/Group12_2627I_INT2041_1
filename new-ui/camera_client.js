/**
 * Generate a unique client identifier using Web Crypto with RFC-4122 v4 fallback.
 */
export function generateClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Send a JSON HTTP request with timeout and safe error extraction.
 */
export async function requestJson(url, method = 'GET', body = null, timeoutMs = 15000) {
  const options = {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : null,
    cache: 'no-store',
  };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    options.signal = AbortSignal.timeout(timeoutMs);
  }
  const res = await fetch(url, options);
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = {};
    }
  }
  if (!res.ok) {
    const message =
      (typeof data.detail === 'string' && data.detail) ||
      (typeof data.error === 'string' && data.error) ||
      `Yêu cầu camera thất bại (HTTP ${res.status}).`;
    throw new Error(message);
  }
  return data;
}

/**
 * Check backend health and model readiness.
 */
export async function checkCameraHealth(timeoutMs = 5000) {
  return requestJson('/api/health', 'GET', null, timeoutMs);
}

/**
 * Manages a local camera recognition session, status polling, heartbeats,
 * and WebSocket gesture notifications.
 */
export class CameraClient {
  constructor(onStatus, onError, onGesture = null) {
    this.onStatus = onStatus;
    this.onError = onError;
    this.onGesture = onGesture;
    this.clientId = generateClientId();
    this.sessionId = null;
    this.generation = 0;
    this.timer = null;
    this.heartbeatTimer = null;
    this.ws = null;
    this.lastGestureSequence = 0;
  }

  previewUrl(session = this.sessionId) {
    return `/api/camera/${session}/preview`;
  }

  clearPollTimers() {
    clearTimeout(this.timer);
    clearInterval(this.heartbeatTimer);
    this.timer = null;
    this.heartbeatTimer = null;
  }

  closeWebSocket() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
  }

  clearTimers() {
    this.clearPollTimers();
    this.closeWebSocket();
  }

  connectWebSocket(session, generation) {
    this.closeWebSocket();
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${location.host}/ws/gesture/${session}`;
    try {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.onmessage = (event) => {
        if (this.generation !== generation || this.sessionId !== session) return;
        try {
          const data = JSON.parse(event.data);
          if (data.gesture && data.sequence > this.lastGestureSequence) {
            this.lastGestureSequence = data.sequence;
            if (this.onGesture) this.onGesture(data);
          }
        } catch (_) {}
      };
    } catch (_) {}
  }

  async start(cameraIndex) {
    const data = await requestJson('/api/camera/start', 'POST', {
      client_id: this.clientId,
      camera_index: cameraIndex,
    });
    this.sessionId = data.session_id;
    this.generation++;
    this.lastGestureSequence = 0;
    this.onStatus(data);
    this.watch();
    this.connectWebSocket(data.session_id, this.generation);
    return data.session_id;
  }

  watch() {
    this.clearPollTimers();
    const session = this.sessionId;
    const generation = this.generation;
    let failures = 0;

    const poll = async () => {
      if (generation !== this.generation || !session) return;
      try {
        const data = await requestJson(`/api/camera/${session}/status`);
        if (generation !== this.generation) return;
        failures = 0;

        if (data.gesture_sequence && data.gesture_sequence > this.lastGestureSequence) {
          this.lastGestureSequence = data.gesture_sequence;
          if (this.onGesture && data.last_gesture) {
            this.onGesture({
              gesture: data.last_gesture,
              sequence: data.gesture_sequence,
            });
          }
        }

        if (['stopped', 'error'].includes(data.state)) {
          this.sessionId = null;
          this.generation++;
          this.clearTimers();
          this.onStatus(data);
          return;
        }
        this.onStatus(data);
      } catch (err) {
        if (generation !== this.generation) return;
        if (++failures >= 3) {
          this.beaconStop();
          this.sessionId = null;
          this.generation++;
          this.clearTimers();
          const msg = err.message || 'Mất kết nối tới server camera.';
          if (this.onError) this.onError(msg);
          this.onStatus({ state: 'error', error: msg });
          return;
        }
      }
      if (generation === this.generation) {
        this.timer = setTimeout(poll, 400);
      }
    };

    this.timer = setTimeout(poll, 200);
    this.heartbeatTimer = setInterval(() => {
      if (session === this.sessionId) {
        requestJson(`/api/camera/${session}/heartbeat`, 'POST').catch(() => {});
      }
    }, 3000);
  }

  async stop() {
    if (!this.sessionId) return;
    const session = this.sessionId;
    this.clearTimers();
    this.generation++;
    this.onStatus({ state: 'stopping' });
    try {
      await requestJson(`/api/camera/${session}/stop`, 'POST');
      this.sessionId = null;
      this.onStatus({ state: 'stopped' });
    } catch (err) {
      this.watch();
      this.connectWebSocket(session, this.generation);
      throw err;
    }
  }

  beaconStop() {
    if (this.sessionId) {
      navigator.sendBeacon(`/api/camera/${this.sessionId}/stop`, '');
    }
  }
}
