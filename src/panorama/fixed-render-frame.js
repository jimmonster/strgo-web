import { renderFixedPanoramas } from './fixed-renderer.js';

let busy = false;
window.addEventListener('message', async event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'strgo:render-fixed' || busy) return;
  busy = true;
  try {
    const { project } = event.data;
    if (!/^\/api\/image\/panorama-tours\/[a-f0-9]{32}\/splat$/.test(project?.splatUrl || '')) throw new Error('空间文件地址无效。');
    const response = await fetch(project.splatUrl, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('共同空间无法读取，请确认账号和访问权限。');
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 64 * 1024 * 1024) throw new Error('空间文件无效或超过大小限制。');
    await renderFixedPanoramas({ bytes, cameras: project.cameras, scale: project.metricScale,
      onPanorama: async (blob, index) => {
        const bytes = await blob.arrayBuffer();
        parent.postMessage({ type: 'strgo:fixed-panorama', index, bytes, mime: blob.type }, location.origin, [bytes]);
      }
    });
    parent.postMessage({ type: 'strgo:fixed-complete' }, location.origin);
  } catch {
    // Decoder errors can include raw input; keep private payloads out of UI.
    parent.postMessage({ type: 'strgo:fixed-error', message: '固定机位渲染失败，请重新打开项目；不会重新调用生成模型。' }, location.origin);
  }
});
parent.postMessage({ type: 'strgo:fixed-render-ready' }, location.origin);
