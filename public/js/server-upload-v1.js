const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function post(path, payload) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error || `Upload request failed (${response.status}).`);
  return result;
}

// channel is the kid's slug; the server refuses a kid's upload to any channel but their own.
export async function publishVideo(file, title, session, onProgress = () => {}, channel = '') {
  if (!file || file.size < 1000 || file.size > 512 * 1024 * 1024) throw new Error('Choose a video under 512 MB.');
  if (!session?.email || !session?.t) throw new Error('Log in to upload.');
  const upload = await post('/api/upload/raw/start', {
    email: session.email, t: session.t, title, size: file.size, ...(channel ? { channel } : {}),
  });
  const total = Math.ceil(file.size / upload.chunkSize);
  const headers = {
    'Content-Type': 'application/octet-stream',
    'X-Kid-Email': session.email, 'X-Kid-Token': session.t,
  };
  let next = 0, completed = 0;
  try {
    onProgress('Uploading 0%');
    async function worker() {
      for (;;) {
        const seq = next++;
        if (seq >= total) return;
        const slice = file.slice(seq * upload.chunkSize, Math.min(file.size, (seq + 1) * upload.chunkSize));
        let success = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await fetch(`/api/upload/raw/chunk/${upload.uploadId}/${seq}`, {
              method: 'POST', headers, body: slice,
            });
            if (response.ok && (await response.json()).ok) { success = true; break; }
          } catch { /* Retry a transient connection failure. */ }
          await wait(600 * (attempt + 1));
        }
        if (!success) throw new Error(`Upload failed at chunk ${seq + 1}. Try again.`);
        completed++;
        onProgress(`Uploading ${Math.round(completed / total * 100)}%`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
    await post('/api/upload/raw/finish', { email: session.email, t: session.t, uploadId: upload.uploadId });
  } catch (error) {
    await post('/api/upload/raw/cancel', { email: session.email, t: session.t, uploadId: upload.uploadId }).catch(() => {});
    throw error;
  }
  onProgress('Processing on server...');
  for (;;) {
    await wait(1500);
    const response = await fetch(`/api/upload/raw/status/${upload.uploadId}`, { headers, cache: 'no-store' });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error || 'Could not check video processing.');
    if (result.status === 'done' && result.clip) return result.clip;
    if (result.status === 'failed') throw new Error(result.error || 'Server could not convert this video.');
    onProgress(result.status === 'queued' ? 'Waiting for server...' : `Processing on server ${result.progress || 0}%`);
  }
}
