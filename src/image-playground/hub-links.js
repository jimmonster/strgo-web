export function requestedJob(search) {
  const params = new URLSearchParams(search);
  const reuse = params.get('reuse'), job = params.get('job');
  const id = reuse || job;
  return /^[a-f0-9]{32}$/.test(id || '') ? { id, reuse: Boolean(reuse) } : null;
}
