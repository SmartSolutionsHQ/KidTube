// Talking to the server as the signed-in parent. The session is the account session the whole app shares
// (js/shell/auth-dialog.js); every dashboard call sends it in the X-Kid-Email and X-Kid-Token headers (the
// cookie alone is not enough, which keeps other sites from acting as the parent).
import { accountSession, clearSession, keepSession } from '/js/shell/auth-dialog.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const OFFLINE = 'Could not reach the server. Check the connection and try again.';

async function send(method, path, body) {
  const session = accountSession();
  const headers = { accept: 'application/json' };
  if (session) Object.assign(headers, { 'X-Kid-Email': session.email, 'X-Kid-Token': session.t });
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'same-origin' });
  } catch { throw new ApiError(0, OFFLINE); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    // The server refuses changes sent from anywhere but the family's web address, with no body.
    const moved = response.status === 403 && !data && method !== 'GET';
    const error = new ApiError(response.status, data?.error || (moved
      ? 'Changes only work from the family\'s web address. Open the dashboard there and sign in.'
      : `Something went wrong (${response.status}). Try again.`));
    if (response.status === 403 && data && /sign in/i.test(error.message)) api.onSignedOut?.();
    throw error;
  }
  return data;
}

export const api = {
  get: path => send('GET', path),
  post: (path, body = {}) => send('POST', path, body),
  // A GET the server may not offer (it answers 404): resolves to null instead of failing.
  async maybe(path) {
    try { return await send('GET', path); } catch (error) { if (error.status === 404) return null; throw error; }
  },
  onSignedOut: null,
};

// Signs in with the normal login route and keeps the session the way the shell does.
export async function signIn(email, pass) {
  let response;
  try {
    response = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, pass }) });
  } catch { throw new ApiError(0, OFFLINE); }
  const reply = await response.json().catch(() => ({}));
  if (!response.ok || !reply.ok) throw new ApiError(response.status, response.status === 429 ? reply.error : 'That email and password don\'t match.');
  if (reply.status !== 'approved') throw new ApiError(403, 'This account is still waiting for a parent to approve it.');
  return keepSession({ email: reply.email || email, t: reply.t, role: reply.role });
}

export async function signOut() {
  await fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
  clearSession();
}
