// The image module supplies only its current text. Image binaries and history
// are never automatically attached to a conversation.
import { AIClient } from '/ai/static/client.js';
import '/ai/static/assistant.js';

const button = document.querySelector('#image-assistant');
let panel, component, client, form, previousPrompt = '';
button?.addEventListener('click', async () => {
  if (panel) { panel.hidden = !panel.hidden; if (!panel.hidden) { try { await client.refreshSession(); } catch { panel.remove(); panel = null; form = null; } } return; }
  button.disabled = true;
  try {
    client = new AIClient(); await client.refreshSession();
    client.addEventListener('auth-changed', () => { component?.remove(); panel?.remove(); panel = null; form = null; });
    if (!client.session.user) { location.assign('/ai/login/'); return; }
    panel = document.createElement('aside'); panel.className = 'image-assistant-dock'; panel.setAttribute('aria-label', '画面创作助手');
    component = document.createElement('strgo-assistant'); panel.append(component); document.body.append(panel);
    const saveContext = async () => {
      const prompt = document.querySelector('#prompt').value;
      if (!form) form = await client.request('/forms', { method: 'POST', body: { kind: 'image', fields: { prompt } } });
      else if (prompt !== previousPrompt) form = await client.request('/forms/' + form.id, { method: 'PUT', body: { revision: form.revision, fields: { prompt } } });
      previousPrompt = prompt; return form;
    };
    await saveContext();
    await component.configure({ client, scope: 'image', formId: form.id, revision: form.revision, beforeSend: saveContext });
    component.addEventListener('strgo:collapse', () => { panel.hidden = true; button.focus(); });
    component.addEventListener('strgo:text-selected', event => { const input = document.querySelector('#prompt'); input.value = event.detail.text; input.dispatchEvent(new Event('input', { bubbles: true })); panel.hidden = true; input.focus(); });
  } catch (error) {
    panel?.remove(); panel = null;
    const status = document.querySelector('#generation-message'); if (status) status.textContent = error.message;
  } finally { button.disabled = false; }
});
document.querySelector('#logout')?.addEventListener('click', () => { component?.remove(); panel?.remove(); panel = null; form = null; });
