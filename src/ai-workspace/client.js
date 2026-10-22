export const API = '/api/ai/v1';
export const terminalStates = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);

export function uuid7(now = Date.now()) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let value = BigInt(now);
  for (let i = 5; i >= 0; i--) { bytes[i] = Number(value & 255n); value >>= 8n; }
  bytes[6] = (bytes[6] & 15) | 112; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class APIError extends Error {
  constructor(status, value) { super(value?.error?.message || value?.error || '连接暂时不可用，请稍后重试。'); this.status = status; this.code = value?.error?.code; this.requestId = value?.request_id; }
}

export class AIClient extends EventTarget {
  constructor() { super(); this.csrf = ''; this.session = null; }
  async request(path, { method = 'GET', body, key, signal } = {}) {
    const response = await fetch(API + path, { method, credentials: 'same-origin', signal, headers: {
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }),
      ...(key ? { 'Idempotency-Key': key } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    let value; try { value = await response.json(); } catch { throw new APIError(response.status, null); }
    if (!response.ok) { const error = new APIError(response.status, value); if (response.status === 401) this.dispatchEvent(new Event('auth-required')); throw error; }
    return value.data;
  }
  async refreshSession() { const previous = this.session; this.session = await this.request('/session'); this.csrf = this.session.csrf || ''; if (previous && previous.user?.id !== this.session.user?.id) this.dispatchEvent(new Event('auth-changed')); this.dispatchEvent(new Event('session')); return this.session; }
  async login(body, register = false) { await this.request('/auth/' + (register ? 'register' : 'login'), { method: 'POST', body }); return this.refreshSession(); }
  async createConversation(scope = 'global', formId) { return this.request('/conversations', { method: 'POST', body: { scope, ...(formId ? { form_id: formId } : {}) } }); }
  async quote(kind, body) { return this.request('/quotes/' + kind, { method: 'POST', body }); }
  async submit(kind, body, key = uuid7()) { return this.request(kind === 'chat' ? '/runs' : '/music/jobs', { method: 'POST', body, key }); }
  async cancel(id) { return this.request('/tasks/' + id + '/cancel', { method: 'POST', body: {} }); }
  async *events(id, { after = 0, signal } = {}) {
    // Reconnects replay saved events only. Creating a run is never a reconnect.
    let failures = 0;
    while (!signal?.aborted) {
      let finished = false;
      try {
        const response = await fetch(`${API}/tasks/${id}/events?after_seq=${after}`, { credentials: 'same-origin', signal, headers: { Accept: 'text/event-stream' } });
        if (response.status === 410) { const task = await this.request('/tasks/' + id, { signal }); yield { seq: after, type: 'snapshot', data: task }; return; }
        if (!response.ok) { let value; try { value = await response.json(); } catch {} throw new APIError(response.status, value); }
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
        try {
          while (true) {
            const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
            let boundary;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
              const lines = block.split('\n'), seq = Number(lines.find(v => v.startsWith('id:'))?.slice(3));
              const type = lines.find(v => v.startsWith('event:'))?.slice(6).trim();
              if (!seq || seq <= after || !type) continue;
              const data = JSON.parse(lines.filter(v => v.startsWith('data:')).map(v => v.slice(5).trimStart()).join('\n'));
              after = seq; failures = 0; yield { seq, type, data };
              if (type === 'state' && terminalStates.has(data.state)) finished = true;
            }
            if (done || finished) break;
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } catch (error) {
        if (signal?.aborted || error.name === 'AbortError' || (error instanceof APIError && error.status < 500 && error.status !== 429)) throw error;
        if (++failures > 5) throw error;
        yield { seq: after, type: 'connection', data: { state: 'reconnecting' } };
      }
      if (finished) return;
      try {
        const task = await this.request('/tasks/' + id, { signal });
        if (terminalStates.has(task.state)) { yield { seq: after, type: 'snapshot', data: task }; return; }
      } catch (error) {
        if (signal?.aborted || (error instanceof APIError && error.status < 500)) throw error;
        if (++failures > 5) throw error;
      }
      await new Promise((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, Math.min(1000 * 2 ** failures, 10000));
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  }
}

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const modelLabel = model => `${model.name} · ${model.locality === 'local' ? '本地' : '在线 API'}`;
export const stateLabel = state => ({ QUEUED: '排队中', DISPATCHING: '正在提交', RUNNING: '生成中', SAVING: '保存中', RECONCILING: '核对结果中', CANCEL_REQUESTED: '正在停止', SUCCEEDED: '已完成', FAILED: '生成失败', CANCELLED: '已取消', INTERRUPTED: '回复中断' }[state] || state);
export const costLabel = quote => quote.currency === 'LOCAL' ? '本地推理 · 无在线 API 费用' : `费用上限 ${quote.currency} ${(quote.max_cost_micro / 1e6).toFixed(4)}`;
