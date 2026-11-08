import {PdfViewer} from "./pdf_viewer.js?v=presentation-1";
import {CameraClient} from "./camera_client.js";

const $ = id => document.getElementById(id);
const viewer = new PdfViewer($("pdfStage"), $("canvasHost"));
let importBusy = false, cameraBusy = false, serverReady = false, cameraState = "stopped";
let previewSession = null;

function showError(message = "") {
  $("errorBanner").textContent = message;
  $("errorBanner").hidden = !message;
}
function controls() {
  const loaded = viewer.currentPage > 0;
  const blocked = !loaded || importBusy || viewer.busy;
  $("viewMode").disabled = blocked;
  $("presentationButton").disabled = blocked && !document.body.classList.contains("presentation-mode");
  $("zoomOut").disabled = blocked || viewer.scale <= 0.25;
  $("zoomIn").disabled = blocked || viewer.scale >= 3;
  $("viewMode").value = viewer.mode;
  $("zoomLevel").textContent = loaded ? `${Math.round(viewer.scale * 100)}%` : "—";
  $("viewHint").textContent = !loaded ? "Mở PDF để chọn cách hiển thị." : viewer.effectiveMode === "width"
    ? "Vừa chiều rộng · Cuộn dọc để đọc hết trang; ← → để đổi trang."
    : viewer.effectiveMode === "custom" ? "Thu/phóng tùy chỉnh · Cuộn để xem phần ngoài khung."
    : "Vừa toàn bộ trang · ← → để đổi trang.";
  $("pdfInput").disabled = importBusy;
  $("previousPage").disabled = importBusy || viewer.busy || !loaded || viewer.currentPage <= 1;
  $("nextPage").disabled = importBusy || viewer.busy || !loaded || viewer.currentPage >= viewer.totalPages;
  $("cameraButton").disabled = cameraBusy || importBusy || !loaded || !serverReady;
  $("cameraButton").textContent = cameraBusy ? "Đang xử lý…" : camera.sessionId ? "Tắt camera" : "Bật camera";
  $("cameraIndex").disabled = cameraBusy || !!camera.sessionId;
  $("pageCounter").textContent = loaded ? `${viewer.currentPage} / ${viewer.totalPages}` : "— / —";
  $("stepCamera").classList.toggle("active", loaded);
  $("stepHand").classList.toggle("active", cameraState === "running");
}
function status(data) {
  cameraState = data.state;
  const labels = {stopped: "Đã tắt", starting: "Đang mở", running: "Đang chạy", stopping: "Đang tắt", error: "Có lỗi"};
  $("cameraBadge").textContent = labels[data.state] || data.state;
  $("cameraBadge").className = `badge ${data.state}`;
  if (data.state === "running") {
    $("cameraEmpty").hidden = true;
    $("cameraPreview").hidden = false;
    $("cameraMessage").textContent = data.hand_count ? `Đã nhận diện ${data.hand_count} bàn tay · hình soi gương` : "Đang tìm bàn tay. Hãy đưa tay vào khung hình.";
  } else if (data.state === "starting") {
    $("cameraPlaceholder").textContent = "Đang mở camera và nạp MediaPipe…";
    $("cameraMessage").textContent = "Lần bật đầu tiên có thể mất vài giây.";
  } else if (["stopped", "error"].includes(data.state)) {
    $("cameraPreview").removeAttribute("src");
    $("cameraPreview").hidden = true;
    $("cameraEmpty").hidden = false;
    previewSession = null;
    $("cameraPlaceholder").textContent = data.state === "error" ? "Chưa kết nối được camera" : viewer.document ? "Camera đã tắt" : "Mở PDF để bật camera";
    $("cameraMessage").textContent = viewer.document ? "Bấm Bật camera để bắt đầu nhận diện." : "Chọn PDF trước khi bắt đầu nhận diện.";
    if (data.error) showError(data.error);
  }
  $("handCount").textContent = data.state === "running" ? data.hand_count : "—";
  $("cameraFps").textContent = data.fps > 0 ? data.fps.toFixed(1) : "—";
  $("processingTime").textContent = data.processing_ms > 0 ? data.processing_ms.toFixed(0) : "—";
  const rows = (data.hands || []).map((hand, index) => {
    const row = document.createElement("div"); row.className = "hand-row";
    const name = document.createElement("span"); name.textContent = `Bàn tay ${index + 1}`;
    const count = document.createElement("span"); count.textContent = `${hand.landmarks.length} khớp đang theo dõi`;
    row.append(name, count); return row;
  });
  $("handDetails").replaceChildren(...rows);
  controls();
}
let hudTimer = null;
function showGestureFeedback(message) {
  const hud = $("gestureHud");
  if (!hud) return;
  hud.textContent = message;
  hud.hidden = false;
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => {
    hud.hidden = true;
  }, 1200);
}

function handleGesture(event) {
  if (!viewer.document) return;
  if (event.gesture === "SWIPE_RIGHT") {
    showGestureFeedback("👉 Trang tiếp theo (Swipe Right)");
    navigate(1);
  } else if (event.gesture === "SWIPE_LEFT") {
    showGestureFeedback("👈 Trang trước (Swipe Left)");
    navigate(-1);
  }
}

const camera = new CameraClient(status, showError, handleGesture);

$("pdfInput").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file || importBusy) return;
  importBusy = true; showError(); controls();
  $("pdfStatus").textContent = "Đang đọc PDF…";
  try {
    await camera.stop();
    await viewer.open(file);
    $("fileName").textContent = file.name;
    $("pdfEmpty").hidden = true;
    $("canvasHost").hidden = false;
    $("pdfStatus").textContent = `${viewer.totalPages} trang`;
    $("cameraPlaceholder").textContent = "Sẵn sàng bật camera";
    $("cameraMessage").textContent = "Bấm Bật camera và đưa tay vào khung hình.";
  } catch (error) {
    showError(error.message);
    if (!viewer.document) {
      $("fileName").textContent = "Chưa có tài liệu";
      $("canvasHost").hidden = true;
      $("pdfEmpty").hidden = false;
    }
    $("pdfStatus").textContent = viewer.document ? `${viewer.totalPages} trang` : "Chọn lại PDF";
  } finally {
    importBusy = false; event.target.value = ""; controls();
  }
});

async function navigate(delta) {
  if (importBusy || viewer.busy || !viewer.document) return;
  try {
    const job = viewer.renderPage(viewer.currentPage + delta); controls();
    await job;
  } catch (error) { showError(`Không hiển thị được trang: ${error.message}`); }
  finally { controls(); }
}
$("previousPage").addEventListener("click", () => navigate(-1));
$("nextPage").addEventListener("click", () => navigate(1));
window.addEventListener("keydown", event => {
  if (event.target.matches("input,select,textarea") || !viewer.document) return;
  if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault(); navigate(event.key === "ArrowRight" ? 1 : -1);
  }
});

$("cameraButton").addEventListener("click", async () => {
  if (cameraBusy || !viewer.document) return;
  cameraBusy = true; showError(); controls();
  try {
    if (camera.sessionId) await camera.stop();
    else {
      const session = await camera.start(Number($("cameraIndex").value));
      previewSession = session;
      $("cameraPreview").src = `/api/camera/${session}/preview`;
    }
  } catch (error) { showError(error.message); }
  finally { cameraBusy = false; controls(); }
});
$("cameraPreview").addEventListener("error", () => {
  if (previewSession && camera.sessionId === previewSession && cameraState === "running") {
    $("cameraMessage").textContent = "Luồng xem trước bị ngắt. Hãy tắt camera rồi bật lại.";
  }
});
window.addEventListener("pagehide", () => camera.beaconStop());
// ResizeObserver theo dõi chính vùng PDF, kể cả khi chỉ đổi bố cục CSS.
let resizeTimer;
const resizeObserver = new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    if (importBusy) return;
    try { await viewer.refresh(); } catch (error) { showError(error.message); }
    finally { controls(); }
  }, 120);
});
resizeObserver.observe($("pdfStage"));

async function changeView(mode, scale = viewer.scale) {
  if (!viewer.document || importBusy || viewer.busy) return;
  viewer.mode = mode;
  if (mode === "custom") viewer.customScale = Math.min(3, Math.max(0.25, scale));
  try {
    const job = viewer.refresh(); controls();
    await job;
    $("pdfStage").scrollTo(0, 0);
  } catch (error) { showError(error.message); }
  finally { controls(); }
}
$("viewMode").addEventListener("change", e => changeView(e.target.value));
$("zoomIn").addEventListener("click", () => changeView("custom", viewer.scale * 1.2));
$("zoomOut").addEventListener("click", () => changeView("custom", viewer.scale / 1.2));

let fullscreenActive = false, presentationBusy = false;
function setPresentation(enabled) {
  document.body.classList.toggle("presentation-mode", enabled);
  $("presentationButton").textContent = enabled ? "Thoát trình chiếu" : "Trình chiếu";
  $("presentationButton").setAttribute("aria-pressed", String(enabled));
  controls();
}
$("presentationButton").addEventListener("click", async () => {
  if (presentationBusy) return;
  presentationBusy = true;
  try {
    if (document.body.classList.contains("presentation-mode")) {
      setPresentation(false);
      if (document.fullscreenElement) await document.exitFullscreen();
    } else {
      setPresentation(true);
      // Gọi trực tiếp từ click để đáp ứng yêu cầu thao tác người dùng.
      try { await document.documentElement.requestFullscreen(); }
      catch { $("viewHint").textContent = "Đang trình chiếu trong cửa sổ · Esc để thoát."; }
    }
  } catch (error) { showError(error.message); }
  finally { presentationBusy = false; }
});
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) fullscreenActive = true;
  else if (fullscreenActive) { fullscreenActive = false; setPresentation(false); }
});
window.addEventListener("keydown", event => {
  if (event.key === "Escape" && !document.fullscreenElement) setPresentation(false);
});

try {
  const response = await fetch("/api/health", {signal: AbortSignal.timeout(5000)});
  const health = await response.json();
  serverReady = response.ok && health.ok && health.model_ready;
  $("serverStatus").textContent = serverReady ? "Local · sẵn sàng" : "Thiếu model";
  $("serverStatus").classList.toggle("ready", serverReady);
  if (!serverReady) showError("Thiếu model nhận diện. Chạy lại install.bat rồi khởi động server.");
} catch { showError("Không kết nối được backend. Hãy chạy run.bat và mở http://127.0.0.1:8000."); }
controls();
