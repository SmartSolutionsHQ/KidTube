// Sends one email through Brevo's API, or nothing at all when email is off (MAIL_MODE=disabled).
import { BRAND_NAME } from './brand.mjs';

export class MailError extends Error {
  constructor(status, retryAfter = 0) {
    super(`Brevo returned HTTP ${status}`);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export async function sendMail(env, to, subject, html, text, { idempotencyKey, fetchImpl = fetch } = {}) {
  if(env.MAIL_MODE==='disabled') return {disabled:true};
  const response = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      sender: { email: env.SENDER_EMAIL, name: BRAND_NAME },
      to: [{ email: to.email, name: to.name || undefined }],
      subject, htmlContent: html, textContent: text,
      ...(idempotencyKey ? { headers: { idempotencyKey } } : {}),
    }),
  });
  const result = await response.json().catch(() => ({}));
  // A retry after a lost response can encounter an email already accepted by Brevo.
  if (idempotencyKey && result.code === 'duplicate_parameter') return { duplicate: true };
  if (!response.ok) {
    const value = response.headers.get('retry-after');
    const retryAfter = value && /^\d+$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now()) || 0;
    throw new MailError(response.status, retryAfter);
  }
  return result;
}
