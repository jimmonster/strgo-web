import { renderMarkdown, clearDocumentPreviews } from './markdown.js';

export function downloadMarkdown(title, body) {
  const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = (title || '论坛帖子').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) + '.md';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createEditor({ textarea, heading, report, upload, canWrite, onUnauthorized }) {
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const wrap = element('div', undefined, 'markdown-editor'), toolbar = element('div', undefined, 'editor-toolbar');
  toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Markdown 编辑工具');
  const preview = element('div', undefined, 'editor-preview'); preview.hidden = true;
  preview.id = textarea.id + '-preview'; preview.setAttribute('aria-label', '正文预览');
  const help = element('p', '支持 Markdown；可上传图片或 PDF，每个最多 5 MiB、每篇最多 12 个。图片说明和附件链接可直接在正文修改。', 'editor-help');
  textarea.parentNode.insertBefore(wrap, textarea);
  wrap.append(toolbar, textarea, help, preview);
  let busy = false, locked = false, version = 0, pendingUpload = null;
  const controls = [];
  function button(text, label, action) {
    const node = element('button', text); node.type = 'button'; node.title = label || text;
    node.setAttribute('aria-label', label || text); node.addEventListener('click', action);
    toolbar.append(node); controls.push(node); return node;
  }
  function refresh() {
    if (!preview.hidden) renderMarkdown(preview, textarea.value, { onUnauthorized });
  }
  function lockControls() {
    textarea.disabled = busy || locked;
    controls.forEach(control => { control.disabled = busy || locked; });
    wrap.setAttribute('aria-busy', String(busy));
  }
  function replaceSelection(before, after = '', fallback = '', range) {
    if (!canWrite()) return false;
    const start = range?.start ?? textarea.selectionStart ?? textarea.value.length;
    const end = range?.end ?? textarea.selectionEnd ?? start;
    const selected = range?.replace ? '' : textarea.value.slice(start, end) || fallback;
    const inserted = before + selected + after;
    const next = textarea.value.slice(0, start) + inserted + textarea.value.slice(end);
    if (next.length > 10000) { report('插入后正文超过 10000 字，请先缩短内容。', true); return false; }
    textarea.value = next; textarea.focus();
    textarea.setSelectionRange?.(start + before.length, start + before.length + selected.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    refresh(); return true;
  }
  const fence = String.fromCharCode(96).repeat(3);
  for (const [text, label, before, after, fallback] of [
    ['B', '粗体', '**', '**', '粗体文字'], ['I', '斜体', '*', '*', '斜体文字'],
    ['H', '标题', '\n## ', '\n', '标题'], ['列表', '项目列表', '\n- ', '\n', '列表项'],
    ['引用', '引用', '\n> ', '\n', '引用内容'], ['代码', '代码块', '\n' + fence + '\n', '\n' + fence + '\n', '代码'],
    ['链接', '插入链接', '[', '](https://example.com)', '链接文字'],
  ]) button(text, label, () => { if (!busy && !locked) replaceSelection(before, after, fallback); });
  const toggle = button('预览', '切换 Markdown 预览', () => {
    preview.hidden = !preview.hidden; toggle.setAttribute('aria-pressed', String(!preview.hidden));
    if (preview.hidden) clearDocumentPreviews(preview); else refresh();
  });
  toggle.setAttribute('aria-pressed', 'false'); toggle.setAttribute('aria-controls', preview.id);
  const markdownFile = element('input'); markdownFile.type = 'file';
  markdownFile.accept = '.md,.markdown,text/markdown,text/plain'; markdownFile.hidden = true;
  markdownFile.dataset.mdImport = '';
  const attachmentFile = element('input'); attachmentFile.type = 'file';
  attachmentFile.accept = '.png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf';
  attachmentFile.hidden = true; attachmentFile.dataset.attachmentInput = '';
  wrap.append(markdownFile, attachmentFile);
  const importer = button('导入 MD', '导入 Markdown 文件并替换正文', () => markdownFile.click());
  importer.dataset.mdImportButton = '';
  button('导出 MD', '导出 Markdown', () => downloadMarkdown(heading.value, textarea.value));
  const attach = button('图片 / PDF', '上传并插入图片或 PDF', () => attachmentFile.click());
  attach.dataset.attachmentButton = '';
  markdownFile.addEventListener('change', async () => {
    const file = markdownFile.files?.[0];
    if (!file || busy || locked || !canWrite()) return;
    const token = version;
    busy = true; lockControls();
    try {
      if (!/\.(md|markdown)$/i.test(file.name) || file.size > 40000) throw new Error('请选择不超过 40 KB 的 UTF-8 Markdown 文件。');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).replace(/^\uFEFF/, '');
      if (text.includes('\0') || !text.trim() || text.length > 10000) throw new Error('Markdown 正文需为 1–10000 字，且不能包含空字符。');
      if (token !== version || !canWrite()) return;
      textarea.value = text;
      if (!heading.value.trim()) heading.value = (/^#\s+(.+)$/m.exec(text)?.[1] || file.name.replace(/\.(md|markdown)$/i, '')).slice(0, 80);
      heading.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('input', { bubbles: true })); refresh();
      report('已导入 Markdown。相对路径图片请另行上传后插入。');
    } catch (error) {
      if (token === version) report(error instanceof TypeError ? '文件不是有效的 UTF-8 文本。' : error.message, true);
    } finally {
      if (token === version) { busy = false; lockControls(); markdownFile.value = ''; }
    }
  });
  attachmentFile.addEventListener('change', async () => {
    const file = attachmentFile.files?.[0];
    if (!file || busy || locked || !canWrite()) return;
    const token = version;
    const range = { start: textarea.selectionStart ?? textarea.value.length, end: textarea.selectionEnd ?? textarea.value.length, replace: true };
    busy = true; lockControls(); report('正在上传附件…');
    try {
      const extensions = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };
      const mime = extensions[file.name.split('.').pop().toLowerCase()];
      if (!mime || file.size > 5 * 1024 * 1024 || !file.size) throw new Error('请选择不超过 5 MiB 的 PNG、JPEG、WebP 图片或 PDF。');
      const identity = [file.name, file.size, file.lastModified].join(':');
      if (pendingUpload?.identity !== identity) {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        pendingUpload = { identity, key: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') };
      }
      const requestId = pendingUpload.key, bytes = new Uint8Array(await file.arrayBuffer());
      if (token !== version || !canWrite()) return;
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      const attachment = await upload({ name: file.name, mime, data: btoa(binary), request_id: requestId });
      if (token !== version || !canWrite()) return;
      const label = attachment.name.replace(/([\\[\]])/g, '\\$1');
      const markdown = mime === 'application/pdf' ? '[' + label + '](' + attachment.url + ' "PDF")'
        : '![' + label + '](' + attachment.url + ')';
      if (replaceSelection('\n\n' + markdown + '\n\n', '', '', range)) { pendingUpload = null; report('附件已插入正文，可预览或继续编辑。'); }
    } catch (error) { if (token === version) report(error.message || '上传失败，请重新选择同一文件重试。', true); }
    finally { if (token === version) { busy = false; lockControls(); attachmentFile.value = ''; } }
  });
  textarea.addEventListener('input', refresh);
  return {
    get busy() { return busy; },
    refresh,
    setLocked(value) { locked = value; lockControls(); },
    reset() {
      version++; busy = locked = false; pendingUpload = null;
      clearDocumentPreviews(preview); preview.replaceChildren(); preview.hidden = true;
      toggle.setAttribute('aria-pressed', 'false');
      markdownFile.value = attachmentFile.value = ''; lockControls();
    },
  };
}
