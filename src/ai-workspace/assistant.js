import { AIClient, escapeHTML as esc, modelLabel, uuid7, costLabel, terminalStates } from './client.js';
import { initialAssistantLocale, assistantText, localizeAssistant } from './assistant-i18n.js';

/** Reusable text-only assistant. The host owns its form and final generation. */
export class StrgoAssistant extends HTMLElement {
  constructor() {
    super(); this.attachShadow({ mode: 'open' }); this.context = { scope: 'global' }; this.messages = []; this.models = []; this.busy = false; this.controller = null;
    this.locale = initialAssistantLocale(); this.localeRecords = new WeakMap(); this.version = 0;
    this.authHandler = () => this.dispatchEvent(new CustomEvent('strgo:auth-required', { bubbles: true, composed: true }));
  }
  connectedCallback() {
    this.render();
    this.localeHandler = event => { if (!['zh-CN','zh-TW','en','ja','ko'].includes(event.detail?.locale)) return; this.locale = event.detail.locale; this.localize(); this.renderModels(); this.renderNotice(); };
    window.addEventListener('strgo:localechange', this.localeHandler);
    this.localeObserver = new MutationObserver(() => this.localize());
    this.localeObserver.observe(this.shadowRoot, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label','title','placeholder'] });
  }
  disconnectedCallback() { this.version++; this.controller?.abort(); this.client?.removeEventListener?.('auth-required', this.authHandler); this.localeObserver?.disconnect(); window.removeEventListener('strgo:localechange', this.localeHandler); }
  localize() { localizeAssistant(this.shadowRoot, this.locale, this.localeRecords); }
  text(source) { return assistantText(source, this.locale); }
  renderNotice() { const el=this.shadowRoot.querySelector('.notice'); if(el) el.textContent=this.text(this.noticeSource || ''); }
  renderModels() {
    const select = this.shadowRoot.querySelector('.model'); if (!select) return;
    select.innerHTML = this.models.length ? this.models.map(model => `<option value="${esc(model.id)}" ${model.id === this.modelId ? 'selected' : ''} ${model.available === false || (this.localOnly && model.locality !== 'local') ? 'disabled' : ''}>${esc(model.name)} · ${esc(this.text(model.locality === 'local' ? '本地' : '在线 API'))}${model.available === false ? ' · ' + esc(this.text('不可用')) : ''}</option>`).join('') : `<option value="">${esc(this.text('暂无可用对话模型'))}</option>`;
  }
  async configure({ client, scope = 'global', formId, revision, conversationId, beforeSend, fullPage = false }) {
    const version = ++this.version;
    this.controller?.abort(); this.client?.removeEventListener?.('auth-required', this.authHandler); this.client = client || new AIClient(); this.client.addEventListener?.('auth-required', this.authHandler); this.context = { scope, formId, revision, conversationId }; this.beforeSend = beforeSend; this.fullPage = fullPage;
    this.messages = []; this.busy = false; this.draft = null; this.pending = null; this.retryOf = null; this.recoverRun = null; this.activeRun = null; this.noticeSource = ''; this.models = []; this.render();
    if (!this.client.session) await this.client.refreshSession();
    if (version !== this.version) return;
    const models = this.client.session.user ? await this.client.request('/models') : [];
    if (version !== this.version) return;
    this.models = models.filter(m => m.kind === 'chat');
    const available = m => m.available !== false && (!this.localOnly || m.locality === 'local');
    this.modelId = this.models.find(m => m.id === this.modelId && available(m))?.id || this.models.find(available)?.id || '';
    this.render();
    if (conversationId) await this.loadConversation(conversationId);
  }
  async loadConversation(id) {
    const version = this.version;
    const info = await this.client.request('/conversations/' + id);
    if (version !== this.version) return;
    if (info.conversation.scope !== this.context.scope || (this.context.formId && info.conversation.form_id !== this.context.formId)) throw new Error('该对话属于其他创作场景，请从对应工作台打开。');
    this.context.conversationId = id;
    this.messages = info.messages.map(m => ({ ...m })); this.renderMessages();
    if (info.drafts?.[0]) { this.draft = info.drafts[0]; this.renderDraft(); }
    const active = info.runs.find(r => !terminalStates.has(r.state));
    if (active) { this.activeRun = active.id; this.follow(active.id, active.output); }
  }
  updateForm(form) { this.context.formId = form.id; this.context.revision = form.revision; }
  render() {
    this.shadowRoot.querySelector('dialog[open]')?.close();
    const scope = this.context.scope, global = scope === 'global';
    this.shadowRoot.innerHTML = `<link rel="stylesheet" href="/ai/static/assistant.css"><section class="assistant ${this.fullPage ? 'full-page' : ''}" aria-label="AI 创作助手">
      <header><div class="brand-symbol">✳</div><h2>${global ? 'AI 对话' : '创作助手'}</h2><button class="icon close-assistant" aria-label="收起助手" title="收起助手">⌃</button></header>
      <div class="context"><span>${global ? '独立对话空间' : '当前上下文：' + (scope === 'music' ? '音乐草稿' : '画面提示词')}</span><select class="model" aria-label="助手使用模型">${this.models.length ? this.models.map(m => `<option value="${esc(m.id)}" ${m.available === false || (this.localOnly && m.locality !== 'local') ? 'disabled' : ''} ${m.id === this.modelId ? 'selected' : ''}>${esc(modelLabel(m))}${m.available === false ? ' · 不可用' : ''}</option>`).join('') : '<option value="">暂无可用对话模型</option>'}</select></div><label class="privacy-choice"><input type="checkbox" class="local-only" ${this.localOnly ? 'checked' : ''}>仅使用本地模型</label>
      <div class="quick-actions">${(scope === 'music' ? ['写歌词', '优化风格', '解释参数'] : scope === 'image' ? ['优化提示词', '构图建议', '描述光线'] : ['聊聊创作灵感', '构思音乐', '解释一个概念']).map((v, i) => `<button data-quick="${i}"><span>${['✎', '⌁', '♧'][i]}</span>${v}</button>`).join('')}</div>
      <div class="messages" role="log" aria-live="polite"></div><div class="draft-slot"></div>
      <div class="composer-area"><p class="notice" role="status"></p><form><label class="sr-only" for="assistant-input">消息</label><textarea id="assistant-input" maxlength="8000" rows="3" placeholder="${scope === 'music' ? '描述你的创作想法…' : '从一个想法开始…'}"></textarea><div class="composer-tools"><span>仅文字 · Enter 发送 / Shift+Enter 换行</span><button class="send" type="submit" aria-label="发送消息">➤</button><button class="recover" type="button" hidden>恢复已有回复</button><button class="stop" type="button" hidden>停止回复</button></div></form><div class="quota">${this.client?.session?.usage ? `今日剩余 ${this.client.session.usage.chat.remaining} 次` : '登录后使用创作助手'}</div></div></section><dialog><div class="dialog-body"></div><button class="dialog-close">关闭</button></dialog>`;
    this.shadowRoot.querySelector('form').onsubmit = e => { e.preventDefault(); this.send(); };
    const input = this.shadowRoot.querySelector('textarea');
    input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); } };
    this.shadowRoot.querySelector('.model').onchange = e => { this.modelId = e.target.value; };
    this.shadowRoot.querySelector('.local-only').onchange = e => { this.localOnly = e.target.checked; const model = this.shadowRoot.querySelector('.model'); for (const option of model.options) { const item = this.models.find(m => m.id === option.value); option.disabled = item?.available === false || (this.localOnly && item?.locality === 'cloud'); } if (model.selectedOptions[0]?.disabled) model.value = [...model.options].find(v => !v.disabled)?.value || ''; this.modelId = model.value; };
    this.shadowRoot.querySelector('.stop').onclick = () => this.client.cancel(this.activeRun).then(() => { if (this.recoverRun) return this.follow(this.recoverRun); }).catch(e => this.notice(e.message));
    this.shadowRoot.querySelector('.recover').onclick = () => this.follow(this.recoverRun);
    this.shadowRoot.querySelector('.close-assistant').onclick = () => this.dispatchEvent(new CustomEvent('strgo:collapse', { bubbles: true, composed: true }));
    this.shadowRoot.querySelector('.dialog-close').onclick = () => this.shadowRoot.querySelector('dialog').close();
    this.shadowRoot.querySelectorAll('[data-quick]').forEach(button => { button.onclick = () => {
      const prompts = scope === 'music' ? ['根据当前音乐草稿，起草一版有画面感的中文歌词。', '优化当前风格描述，让编曲、情绪和节奏更清晰。', '解释音乐时长、BPM、调性和随机种子的作用。'] : scope === 'image' ? ['优化我当前的画面提示词，保留主体和创作意图。', '为当前画面提供三个构图建议。', '为当前画面描述适合的光线和色彩。'] : ['帮我梳理一个新的创作灵感。', '帮我构思一首温暖的中文流行歌曲。', '用简单的例子解释一个有趣的概念。'];
      input.value = this.text(prompts[Number(button.dataset.quick)]); this.quickExplanation = scope === 'music' && Number(button.dataset.quick) === 2 ? input.value : ''; input.focus();
    }; });
    this.renderMessages(); this.renderModels(); this.setBusy(this.busy); this.localize();
  }
  renderMessages() {
    const area = this.shadowRoot.querySelector('.messages'); if (!area) return;
    if (!this.messages.length) area.innerHTML = `<div class="welcome"><div class="welcome-orbit">✳</div><h3>${this.context.scope === 'global' ? '让灵感，有个回响。' : '好作品，从好想法开始。'}</h3><p>${this.context.scope === 'music' ? '一起写歌词、打磨风格，找到属于你的声音。' : '说说你的想法，我们一起把它变得清晰。'}</p><span>当前对话独立保存 · 作品默认仅自己可见</span></div>`;
    else {
      area.innerHTML = this.messages.map((message, i) => `<article class="message ${message.role === 'user' ? 'user' : 'ai'}"><span class="avatar">${message.role === 'user' ? '我' : '✳'}</span><div><p class="message-name">${message.role === 'user' ? '你' : 'STRGO 助手'}</p><div class="message-content">${esc(message.content)}</div>${message.role === 'assistant' && message.state === 'SUCCEEDED' ? `<div class="message-actions"><button data-copy="${i}">复制</button>${this.context.scope === 'global' ? `<button data-transfer="${i}">带入音乐工作台 ↗</button>` : this.context.scope === 'image' ? `<button data-image="${i}">预览并应用提示词 ↗</button>` : ''}</div>` : message.state && !['SUCCEEDED', 'QUEUED', 'RUNNING'].includes(message.state) ? `<span class="partial">部分内容 · 不会自动加入后续上下文</span>${message.role === 'user' && message.task_id && ['FAILED','CANCELLED','INTERRUPTED'].includes(message.state) ? `<div class="message-actions"><button data-retry="${i}">编辑后重试</button></div>` : ''}` : ''}</div></article>`).join('');
      area.querySelectorAll('[data-retry]').forEach(button => { button.onclick = () => {
        if (this.busy || this.recoverRun) { this.notice('请先停止或恢复当前回复。'); return; }
        if (this.pending) { this.notice('再次发送会使用原请求标识核对，不会重复创建任务。'); return; }
        const input = this.shadowRoot.querySelector('textarea');
        if (input.value.trim()) { this.notice('请先发送或清空当前输入。'); return; }
        const original = this.messages[Number(button.dataset.retry)];
        input.value = original.content; this.retryOf = original.task_id; input.focus();
        this.notice('消息已放回输入框，确认发送后会创建新的任务。');
      }; });
      area.querySelectorAll('[data-copy]').forEach(b => { b.onclick = () => navigator.clipboard.writeText(this.messages[Number(b.dataset.copy)].content).then(() => this.notice('已复制。')).catch(() => this.notice('请选中文字后复制。')); });
      area.querySelectorAll('[data-transfer]').forEach(b => { b.onclick = () => this.selectionDialog(this.messages[Number(b.dataset.transfer)]); });
      area.querySelectorAll('[data-image]').forEach(b => { b.onclick = () => this.selectionDialog(this.messages[Number(b.dataset.image)], true); });
    }
    area.scrollTop = area.scrollHeight;
  }
  notice(message) { this.noticeSource = message; this.renderNotice(); }
  setBusy(value) { this.busy = value; this.shadowRoot.querySelector('.send').hidden = value || Boolean(this.recoverRun); this.shadowRoot.querySelector('.stop').hidden = !value && !this.recoverRun; this.shadowRoot.querySelector('.recover').hidden = value || !this.recoverRun; this.shadowRoot.querySelector('.model').disabled = value; this.shadowRoot.querySelector('.local-only').disabled = value; }
  async send() {
    if (this.busy || this.recoverRun) return;
    const version = this.version;
    const input = this.shadowRoot.querySelector('textarea'), content = input.value.trim(); if (!content && !this.pending) return;
    if (!this.client?.session?.user) { this.dispatchEvent(new CustomEvent('strgo:auth-required', { bubbles: true, composed: true })); this.notice('请先登录 STRGO 账号。'); return; }
    if (!this.modelId) { this.notice('暂无已授权的对话模型，请在权限设置中申请。'); return; }
    this.setBusy(true); this.notice('');
    try {
      if (!this.pending) {
        if (this.beforeSend) { const form = await this.beforeSend(); if (version !== this.version) return; if (form) this.updateForm(form); }
        if (!this.context.conversationId) {
          const conversation = await this.client.createConversation(this.context.scope, this.context.formId);
          if (version !== this.version) return;
          this.context.conversationId = conversation.id;
          this.dispatchEvent(new CustomEvent('strgo:conversation-created', { detail: conversation, bubbles: true, composed: true }));
        }
        const body = { model_id: this.modelId, conversation_id: this.context.conversationId, content, local_only: Boolean(this.localOnly),
          mode: this.context.scope === 'music' && content !== this.quickExplanation && !/解释|explain|説明|설명/i.test(content) ? 'music_draft' : 'chat',
          ...(this.context.formId ? { form_revision: this.context.revision } : {}), ...(this.retryOf ? { retry_of_run_id: this.retryOf } : {}) };
        const quote = await this.client.quote('chat', body);
        if (version !== this.version) return;
        if (quote.locality === 'cloud') {
          const confirmed = await this.confirmCost(quote);
          if (version !== this.version) return;
          if (!confirmed) { this.setBusy(false); return; }
        }
        if (version !== this.version) return;
        this.pending = { body: { ...body, quote_id: quote.id }, key: uuid7() };
      }
      const run = await this.client.submit('chat', this.pending.body, this.pending.key);
      if (version !== this.version) return;
      this.messages.push({ role: 'user', content: this.pending.body.content, state: 'SUCCEEDED' });
      this.pending = null; this.retryOf = null; input.value = ''; this.activeRun = run.id; this.renderMessages();
      await this.follow(run.id, run.output);
    } catch (error) {
      if (version !== this.version) return;
      this.notice(error.message + (this.pending ? ' 再次发送会使用原请求标识核对，不会重复创建任务。' : ''));
      if (error.status && error.status < 500) this.pending = null;
      this.setBusy(false);
    }
  }
  async confirmCost(quote) {
    const dialog = this.shadowRoot.querySelector('dialog'), body = dialog.querySelector('.dialog-body');
    body.innerHTML = `<h3>确认使用在线对话模型</h3><p>${esc(costLabel(quote))}</p><p>本次消耗 1 次对话额度。消息会发送给所选 API 服务。</p><button class="primary confirm-cost">确认发送</button>`;
    dialog.showModal();
    return new Promise(resolve => { let approved = false; body.querySelector('button').onclick = () => { approved = true; dialog.close(); }; dialog.addEventListener('close', () => resolve(approved), { once: true }); });
  }
  async follow(id, initial = '') {
    if (!id) return;
    this.controller?.abort();
    const controller = new AbortController(), version = this.version, conversationId = this.context.conversationId;
    const current = () => version === this.version && this.controller === controller && !controller.signal.aborted;
    this.controller = controller; this.activeRun = id; this.recoverRun = null; this.setBusy(true); this.notice('');
    let message = this.messages.find(m => m.task_id === id && m.role === 'assistant');
    if (!message) { message = { role: 'assistant', task_id: id, content: initial || '', state: 'RUNNING' }; this.messages.push(message); }
    this.renderMessages();
    try {
      let resumed = false;
      for await (const event of this.client.events(id, { signal: controller.signal })) {
        if (!current()) return;
        if (event.type === 'delta') { if (!resumed) { message.content = ''; resumed = true; } message.content += event.data.text; this.renderMessages(); }
        if (event.type === 'connection') this.notice('连接暂时中断，正在恢复已有回复…');
        if (event.type === 'draft') { this.draft = event.data; this.renderDraft(); }
        if (event.type === 'draft_invalid') this.notice(event.data.message);
        if (event.type === 'state' && terminalStates.has(event.data.state)) { message.state = event.data.state; if (event.data.error) this.notice(event.data.error); }
        if (event.type === 'snapshot') { message.content = event.data.output; message.state = event.data.state; }
      }
      if (!current()) return;
      const info = await this.client.request('/conversations/' + conversationId);
      if (!current()) return;
      this.messages = info.messages; this.renderMessages();
      await this.client.refreshSession();
      if (!current()) return;
      this.activeRun = null;
      this.shadowRoot.querySelector('.quota').textContent = `今日剩余 ${this.client.session.usage.chat.remaining} 次`;
      this.dispatchEvent(new CustomEvent('strgo:run-completed', { detail: { id }, bubbles: true, composed: true }));
    } catch (error) {
      if (current() && error.name !== 'AbortError') { this.recoverRun = id; this.notice('连接已断开，可恢复已有回复；不会重新生成。'); }
    } finally { if (current()) this.setBusy(false); }
  }
  renderDraft() {
    const area = this.shadowRoot.querySelector('.draft-slot');
    area.innerHTML = `<div class="draft-card"><div class="draft-title">✧ 修改建议<span>待应用</span></div><pre>${esc(Object.values(this.draft.patch).map(v => typeof v === 'string' ? v : JSON.stringify(v)).join('\n\n'))}</pre><div class="draft-buttons"><button class="preview">预览修改</button><button class="apply primary">✓ 应用到表单</button></div></div><p class="safe-tip">ⓘ 应用后，请在创作表单中确认生成。</p>`;
    area.querySelector('.preview').onclick = () => this.previewDraft().catch(e => this.notice(e.message));
    area.querySelector('.apply').onclick = () => this.applyDraft().catch(e => this.notice(e.message));
  }
  async previewDraft() {
    const version = this.version;
    const draft = await this.client.request('/drafts/' + this.draft.id), dialog = this.shadowRoot.querySelector('dialog');
    if (version !== this.version) return;
    dialog.querySelector('.dialog-body').innerHTML = `<h3>预览修改</h3>${Object.entries(draft.patch).map(([k, v]) => `<h4>${esc({ title: '标题', prompt: '风格描述', lyrics: '歌词', duration: '时长', tags: '标签', instrumental: '纯音乐' }[k])}</h4><div class="diff"><pre>${esc(typeof draft.before[k] === 'object' ? JSON.stringify(draft.before[k]) : draft.before[k])}</pre><pre>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</pre></div>`).join('')}<button class="apply-in-dialog primary">应用到表单</button>`;
    dialog.querySelector('.apply-in-dialog').onclick = () => this.applyDraft().then(() => dialog.close()).catch(e => this.notice(e.message)); dialog.showModal();
  }
  async applyDraft() {
    const version = this.version, draftId = this.draft.id;
    if (this.beforeSend) { const current = await this.beforeSend(); if (version !== this.version) return; if (current) this.updateForm(current); }
    const form = await this.client.request('/drafts/' + draftId + '/apply', { method: 'POST', body: { revision: this.context.revision } });
    if (version !== this.version) return;
    this.updateForm(form); this.shadowRoot.querySelector('.draft-slot').innerHTML = '<p class="safe-tip">✓ 已应用到表单。确认生成后才会创建音乐任务。</p>';
    this.dispatchEvent(new CustomEvent('strgo:draft-applied', { detail: form, bubbles: true, composed: true }));
  }
  selectionDialog(message, image = false) {
    const dialog = this.shadowRoot.querySelector('dialog'), selection = this.shadowRoot.getSelection?.()?.toString() || '';
    dialog.querySelector('.dialog-body').innerHTML = `<h3>${image ? '应用画面提示词' : '带入音乐工作台'}</h3><p>仅传递下方确认的文字；新模块使用独立对话。</p><textarea class="selection" maxlength="${image ? 8000 : 3500}" rows="10"></textarea><p class="selection-error"></p><button class="primary transfer-confirm">${image ? '应用到提示词' : '创建音乐草稿'}</button>`;
    const input = dialog.querySelector('.selection'); input.value = selection && message.content.includes(selection) ? selection : message.content.slice(0, image ? 8000 : 3500);
    dialog.querySelector('.transfer-confirm').onclick = async () => {
      try {
        if (image) this.dispatchEvent(new CustomEvent('strgo:text-selected', { detail: { text: input.value }, bubbles: true, composed: true }));
        else {
          const target = await this.client.request('/conversations/' + this.context.conversationId + '/transfer', { method: 'POST', body: { message_id: message.id, selection: input.value } });
          location.assign('/ai/music/?form=' + target.form_id + '&conversation=' + target.conversation_id);
        }
        dialog.close();
      } catch (error) { dialog.querySelector('.selection-error').textContent = error.message; }
    }; dialog.showModal();
  }
}
if (!customElements.get('strgo-assistant')) customElements.define('strgo-assistant', StrgoAssistant);
