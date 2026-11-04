import { Marked } from '../assets/vendor/marked.esm.js';

// Only the lexer is used: user HTML never enters an HTML parser.
const markdownParser = new Marked({ gfm: true, breaks: true });
const attachmentPath = /^\/api\/image\/forum\/attachments\/[a-f0-9]{32}(?:\?download=1)?$/;
const markdownElement = (tag, text) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
};
function safeLink(value) {
  if (attachmentPath.test(value || '')) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function clearDocumentPreviews(container) {
  container.querySelectorAll('[data-forum-pdf]').forEach(element => {
    element.cancelPDF?.();
    element.dataset.closed = 'true';
  });
}
export function renderMarkdown(container, source, options = {}) {
  clearDocumentPreviews(container);
  container.replaceChildren();
  container.classList.add('markdown-body');
  container.setAttribute('data-strgo-user-content', '');
  function append(parent, tokens) {
    for (const token of tokens || []) {
      const nested = (tag, children = token.tokens, text) => {
        const element = markdownElement(tag, text);
        append(element, children); parent.append(element); return element;
      };
      switch (token.type) {
        case 'space': break;
        case 'heading': nested('h' + Math.min(6, token.depth)); break;
        case 'paragraph': nested('p'); break;
        case 'strong': nested('strong'); break;
        case 'em': nested('em'); break;
        case 'del': nested('del'); break;
        case 'blockquote': nested('blockquote'); break;
        case 'br': parent.append(markdownElement('br')); break;
        case 'hr': parent.append(markdownElement('hr')); break;
        case 'codespan': parent.append(markdownElement('code', token.text)); break;
        case 'code': {
          const pre = markdownElement('pre');
          pre.append(markdownElement('code', token.text)); parent.append(pre); break;
        }
        case 'list': {
          const list = markdownElement(token.ordered ? 'ol' : 'ul');
          if (token.ordered && Number.isSafeInteger(token.start)) list.start = token.start;
          for (const item of token.items) {
            const li = markdownElement('li');
            if (item.task) {
              const box = markdownElement('input'); box.type = 'checkbox';
              box.checked = item.checked; box.disabled = true; li.append(box);
            }
            append(li, item.tokens); list.append(li);
          }
          parent.append(list); break;
        }
        case 'table': {
          const wrap = markdownElement('div'), table = markdownElement('table');
          wrap.className = 'markdown-table';
          const head = markdownElement('thead'), heading = markdownElement('tr');
          token.header.forEach(cell => { const th = markdownElement('th'); append(th, cell.tokens); heading.append(th); });
          head.append(heading); table.append(head);
          const body = markdownElement('tbody');
          token.rows.forEach(cells => {
            const row = markdownElement('tr');
            cells.forEach(cell => { const td = markdownElement('td'); append(td, cell.tokens); row.append(td); });
            body.append(row);
          });
          table.append(body); wrap.append(table); parent.append(wrap); break;
        }
        case 'link': {
          const href = safeLink(token.href);
          if (!href) { append(parent, token.tokens); break; }
          const link = markdownElement('a'); link.href = href;
          link.rel = 'noopener noreferrer'; append(link, token.tokens); parent.append(link);
          if (attachmentPath.test(href)) {
            link.href = href.split('?')[0] + '?download=1'; link.setAttribute('download', '');
            if (token.title === 'PDF' || /\.pdf$/i.test(token.text)) {
              const holder = markdownElement('span');
              holder.dataset.forumPdf = ''; holder.className = 'pdf-card';
              const preview = markdownElement('button', '预览 PDF'); preview.type = 'button'; preview.className = 'pdf-open';
              preview.setAttribute('data-strgo-ui-copy', '');
              preview.addEventListener('click', async () => {
                if (preview.disabled) return;
                preview.disabled = true;
                try {
                  const { createPDFPreview } = await import('./pdf-preview.js');
                  if (holder.dataset.closed === 'true' || !holder.isConnected) return;
                  holder.cancelPDF = createPDFPreview(holder, href.split('?')[0], options);
                } catch { preview.disabled = false; preview.textContent = '预览加载失败，点击重试'; }
              });
              holder.append(preview); parent.append(holder);
            }
          } else { link.target = '_blank'; }
          break;
        }
        case 'image': {
          // Imported external images remain text; uploads stay within the CSP.
          if (!attachmentPath.test(token.href || '')) {
            parent.append(document.createTextNode('[图片：' + token.text + '，请上传后插入]')); break;
          }
          const image = markdownElement('img'); image.src = token.href;
          image.alt = token.text || '帖子图片'; image.loading = 'lazy'; image.decoding = 'async';
          image.referrerPolicy = 'no-referrer'; parent.append(image); break;
        }
        case 'text':
          if (token.tokens) append(parent, token.tokens);
          else parent.append(document.createTextNode(token.text || ''));
          break;
        case 'escape': parent.append(document.createTextNode(token.text || '')); break;
        case 'html': parent.append(document.createTextNode(token.raw || token.text || '')); break;
        default: parent.append(document.createTextNode(token.raw || token.text || ''));
      }
    }
  }
  try { append(container, markdownParser.lexer(String(source || ''))); }
  catch { container.textContent = String(source || ''); }
}
