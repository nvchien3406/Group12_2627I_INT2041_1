async function request(url, method = "GET", body = null) {
  const response = await fetch(url, {
    method,
    headers: body ? {"Content-Type": "application/json"} : {},
    body: body ? JSON.stringify(body) : null,
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Yêu cầu camera không hợp lệ.");
  return data;
}

export class CameraClient {
  constructor(onStatus, onError, onGesture = null) {
    this.onStatus = onStatus;
    this.onError = onError;
    this.onGesture = onGesture;
    this.clientId = crypto.randomUUID();
    this.sessionId = null;
    this.generation = 0;
    this.timer = this.heartbeatTimer = null;
    this.ws = null;
    this.lastGestureSequence = 0;
  }

  clearTimers() {
    clearTimeout(this.timer);
    clearInterval(this.heartbeatTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
  }

  connectWebSocket(session, generation) {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
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
      ws.onerror = () => {
        // Fallback polling will handle it
      };
    } catch (_) {}
  }

  async start(cameraIndex) {
    const data = await request("/api/camera/start", "POST", {
      client_id: this.clientId,
      camera_index: cameraIndex,
    });
    this.sessionId = data.session_id;
    this.generation++;
    this.lastGestureSequence = 0;
    this.onStatus(data);
    this.connectWebSocket(data.session_id, this.generation);
    this.watch();
    return data.session_id;
  }

  watch() {
    this.clearTimers();
    const session = this.sessionId,
      generation = this.generation;
    let failures = 0;

    const poll = async () => {
      if (generation !== this.generation || !session) return;
      try {
        const data = await request(`/api/camera/${session}/status`);
        if (generation !== this.generation) return;
        failures = 0;

        // Fallback nhận diện gesture nếu WebSocket không kịp tới
        if (data.gesture_sequence && data.gesture_sequence > this.lastGestureSequence) {
          this.lastGestureSequence = data.gesture_sequence;
          if (this.onGesture && data.last_gesture) {
            this.onGesture({gesture: data.last_gesture, sequence: data.gesture_sequence});
          }
        }

        if (["stopped", "error"].includes(data.state)) {
          this.sessionId = null;
          this.generation++;
          this.clearTimers();
          this.onStatus(data);
          return;
        }
        this.onStatus(data);
      } catch (error) {
        if (generation !== this.generation) return;
        if (++failures >= 3) {
          this.beaconStop();
          this.sessionId = null;
          this.generation++;
          this.clearTimers();
          this.onStatus({
            state: "error",
            error: "Mất kết nối tới camera. Kiểm tra terminal server rồi thử lại.",
          });
          return;
        }
      }
      if (generation === this.generation) this.timer = setTimeout(poll, 400);
    };

    this.timer = setTimeout(poll, 200);
    this.heartbeatTimer = setInterval(() => {
      if (session === this.sessionId) request(`/api/camera/${session}/heartbeat`, "POST").catch(() => {});
    }, 3000);
  }

  async stop() {
    if (!this.sessionId) return;
    const session = this.sessionId;
    this.clearTimers();
    this.generation++;
    this.onStatus({state: "stopping"});
    try {
      await request(`/api/camera/${session}/stop`, "POST");
      this.sessionId = null;
      this.onStatus({state: "stopped"});
    } catch (error) {
      this.watch();
      throw error;
    }
  }

  beaconStop() {
    if (this.sessionId) navigator.sendBeacon(`/api/camera/${this.sessionId}/stop`, "");
  }
}
