// Render page pixels without embedding active PDF scripts, forms or actions.
export function createPDFPreview(container, url, { onUnauthorized } = {}) {
  const controller = new AbortController();
  let disposed = false, loadingTask, documentTask, renderTask, pageNumber = 1;
  const element = (tag, text) => {
    const node = document.createElement(tag);
    node.setAttribute('data-strgo-ui-copy', '');
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const status = element('span', '正在读取 PDF…'); status.setAttribute('role', 'status');
  const controls = element('span'); controls.className = 'pdf-controls';
  const previous = element('button', '上一页'), next = element('button', '下一页'), close = element('button', '收起预览');
  for (const button of [previous, next, close]) button.type = 'button';
  previous.disabled = next.disabled = true;
  previous.dataset.pdfPrevious = ''; next.dataset.pdfNext = '';
  const canvas = element('canvas'); canvas.setAttribute('aria-label', 'PDF 当前页');
  controls.append(previous, status, next, close); container.replaceChildren(controls, canvas);
  function dispose() {
    if (disposed) return;
    disposed = true; controller.abort(); renderTask?.cancel();
    if (loadingTask) loadingTask.destroy().catch(() => {});
    canvas.width = canvas.height = 0;
  }
  close.addEventListener('click', () => {
    dispose();
    container.replaceChildren(element('span', '预览已收起，可通过附件链接下载。'));
  });
  async function render() {
    previous.disabled = next.disabled = true;
    try {
      const page = await documentTask.getPage(pageNumber);
      if (disposed) return;
      const initial = page.getViewport({ scale: 1 });
      const width = Math.max(200, Math.min(container.clientWidth || 600, 900));
      const viewport = page.getViewport({ scale: width / initial.width * Math.min(window.devicePixelRatio || 1, 2) });
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      await renderTask.promise;
      if (disposed) return;
      status.textContent = pageNumber + ' / ' + documentTask.numPages;
      container.dataset.page = String(pageNumber); container.dataset.pages = String(documentTask.numPages);
      previous.disabled = pageNumber <= 1; next.disabled = pageNumber >= documentTask.numPages;
      page.cleanup();
    } catch {
      if (!disposed) status.textContent = '此页无法预览，请下载原文件。';
    }
  }
  previous.addEventListener('click', () => { if (!previous.disabled) { pageNumber--; void render(); } });
  next.addEventListener('click', () => { if (!next.disabled) { pageNumber++; void render(); } });
  void (async () => {
    try {
      const pdf = await import('../assets/vendor/pdfjs/pdf.js');
      if (disposed) return;
      pdf.GlobalWorkerOptions.workerSrc = new URL('../assets/vendor/pdfjs/pdf.worker.js', import.meta.url).href;
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (response.status === 401) { onUnauthorized?.(); throw new Error('会话已过期'); }
      if (!response.ok) throw new Error('附件不可用');
      const data = new Uint8Array(await response.arrayBuffer());
      if (disposed) return;
      loadingTask = pdf.getDocument({
        data, isEvalSupported: false, useWasm: false,
        cMapUrl: new URL('../assets/vendor/pdfjs/cmaps/', import.meta.url).href, cMapPacked: true,
        standardFontDataUrl: new URL('../assets/vendor/pdfjs/standard_fonts/', import.meta.url).href,
        wasmUrl: new URL('../assets/vendor/pdfjs/wasm/', import.meta.url).href,
      });
      documentTask = await loadingTask.promise;
      if (!disposed) await render();
    } catch {
      if (!disposed) status.textContent = 'PDF 无法预览，可通过附件链接下载原文件。';
    }
  })();
  return dispose;
}
