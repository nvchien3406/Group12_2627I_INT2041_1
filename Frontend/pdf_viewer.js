import * as pdfjs from "/static/vendor/pdfjs/build/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "/static/vendor/pdfjs/build/pdf.worker.mjs";

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
    this.mode = "auto";
    this.scale = 1;
    this.customScale = 1;
    this.pendingRefresh = false;
  }

  async close() {
    this.generation++;
    if (this.renderTask) {
      this.renderTask.cancel();
      await this.renderTask.promise.catch(() => {});
    }
    if (this.loadingTask) await this.loadingTask.destroy();
    this.document = this.loadingTask = this.renderTask = null;
    this.currentPage = this.totalPages = 0;
    this.busy = false;
    this.pendingRefresh = false;
    this.host.replaceChildren();
  }

  async open(file) {
    if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error("Hãy chọn file có đuôi .pdf.");
    if (file.size === 0 || file.size > 50 * 1024 * 1024) throw new Error("PDF phải có dữ liệu và không lớn hơn 50 MB.");
    await this.close();
    this.mode = "auto";
    this.customScale = 1;
    const generation = this.generation;
    let needsPassword = false;
    this.loadingTask = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      cMapUrl: "/static/vendor/pdfjs/cmaps/", cMapPacked: true,
      standardFontDataUrl: "/static/vendor/pdfjs/standard_fonts/",
      wasmUrl: "/static/vendor/pdfjs/wasm/",
      isEvalSupported: false,
    });
    this.loadingTask.onPassword = () => {
      needsPassword = true;
      this.loadingTask.destroy().catch(() => {});
    };
    try {
      const document = await this.loadingTask.promise;
      if (generation !== this.generation) return;
      this.document = document;
      this.totalPages = document.numPages;
      await this.renderPage(1);
    } catch (error) {
      await this.close();
      throw new Error(needsPassword ? "PDF có mật khẩu. Baseline này cần một bản PDF không khóa." : `Không đọc được PDF: ${error.message}`);
    }
  }

  async renderPage(number) {
    if (!this.document || this.busy || number < 1 || number > this.totalPages) return;
    this.busy = true;
    const generation = this.generation;
    try {
      const page = await this.document.getPage(number);
      const original = page.getViewport({scale: 1});
      const padding = getComputedStyle(this.stage);
      const width = Math.max(1, this.stage.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight));
      const height = Math.max(1, this.stage.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom));
      const fit = Math.min(width / original.width, height / original.height);
      const effectiveMode = this.mode === "auto" ? (original.height > original.width ? "width" : "page") : this.mode;
      const scale = effectiveMode === "custom" ? this.customScale : effectiveMode === "width" ? width / original.width : fit;
      const viewport = page.getViewport({scale});
      // Giới hạn bitmap để PDF lớn hoặc zoom cao không làm hết bộ nhớ trình duyệt.
      const ratio = Math.min(window.devicePixelRatio || 1, 2,
        8192 / viewport.width, 8192 / viewport.height,
        Math.sqrt(16000000 / (viewport.width * viewport.height)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      this.renderTask = page.render({canvasContext: canvas.getContext("2d"), viewport, transform: [ratio, 0, 0, ratio, 0, 0]});
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
        if (this.pendingRefresh) {
          this.pendingRefresh = false;
          await this.renderPage(this.currentPage);
        }
      }
    }
  }

  async refresh() {
    if (!this.document) return;
    if (this.busy) { this.pendingRefresh = true; return; }
    await this.renderPage(this.currentPage);
  }
}

