// Saving badges: the browser sends only the spec and the server draws the SVG itself. Home-screen icons
// are the one exception the server can't draw (it has no rasterizer), so the browser rasterizes the
// server's own SVG with a canvas and uploads PNGs, which the server checks byte by byte.
//
//   await saveChannelBadge(channelId, spec)       → { spec, svg, url, logoUrl }
//   await saveFamilyBadge(spec)                   → { spec, svg, url, icons: { 192, 512, maskable-512, apple-180 } }
//   await uploadChannelImage(channelId, file)     → { url, width, height }
//   await removeChannelImage(channelId)

// Sizes and padding for each icon. Maskable icons keep the badge inside the 80% safe zone; Apple
// draws its own rounded corners over an opaque square.
export const ICONS = [
  { variant: '192', size: 192, inset: 0, background: null },
  { variant: '512', size: 512, inset: 0, background: null },
  { variant: 'maskable-512', size: 512, inset: 0.12, background: '#05060A' },
  { variant: 'apple-180', size: 180, inset: 0.08, background: '#05060A' },
];

// The parent's session, as the rest of the app stores it.
export function storedSession() {
  try {
    const session = JSON.parse(localStorage.getItem('kid-session') || 'null');
    return session?.email && session?.t && session.exp > Date.now() ? { email: session.email, t: session.t } : null;
  } catch { return null; }
}

function authHeaders(auth) {
  const session = auth || storedSession();
  if (!session) throw new Error('Sign in as a parent first.');
  return { 'X-Kid-Email': session.email, 'X-Kid-Token': session.t };
}

async function send(path, { method = 'PUT', body, type, auth }) {
  const headers = authHeaders(auth);
  if (type) headers['Content-Type'] = type;
  const response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || `Saving failed (${response.status}).`);
  return result;
}

export function saveChannelBadge(channelId, spec, auth) {
  return send(`/api/admin/channels/${encodeURIComponent(channelId)}/badge`, { body: JSON.stringify({ spec }), type: 'application/json', auth });
}

export function uploadChannelImage(channelId, file, auth) {
  if (file.size > 2 * 1024 * 1024) return Promise.reject(new Error('Pictures must be under 2 MB.'));
  return send(`/api/admin/channels/${encodeURIComponent(channelId)}/image`, { body: file, type: 'application/octet-stream', auth });
}

export function removeChannelImage(channelId, auth) {
  return send(`/api/admin/channels/${encodeURIComponent(channelId)}/image`, { method: 'DELETE', auth });
}

function loadImage(svg) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not draw the badge.')); };
    image.src = url;
  });
}

// Draws an SVG badge into each icon size and returns PNG blobs keyed by variant.
export async function rasterizeIcons(svg) {
  const image = await loadImage(svg);
  const icons = {};
  for (const { variant, size, inset, background } of ICONS) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    if (background) { context.fillStyle = background; context.fillRect(0, 0, size, size); }
    const pad = Math.round(size * inset);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, pad, pad, size - pad * 2, size - pad * 2);
    icons[variant] = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not make the icon.')), 'image/png'));
  }
  return icons;
}

// Saves the family badge, then makes and uploads the home-screen icons from the server's SVG.
export async function saveFamilyBadge(spec, auth, { icons = true } = {}) {
  const saved = await send('/api/admin/brand/badge', { body: JSON.stringify({ spec }), type: 'application/json', auth });
  if (!icons) return saved;
  const blobs = await rasterizeIcons(saved.svg);
  const urls = {};
  for (const { variant } of ICONS) {
    urls[variant] = (await send(`/api/admin/brand/icons/${variant}`, { body: blobs[variant], type: 'image/png', auth })).url;
  }
  return { ...saved, icons: urls };
}
