// New-video emails: an outbox in SQLite, filled when a clip goes live and drained with retries, and the
// signed unsubscribe link every email carries.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { sendMail } from './mail.mjs';
import { BRAND_NAME, DEFAULT_ACCENT, WORDMARK, escapeHtml } from './brand.mjs';
import { DEFAULT_CHANNEL_ID } from './channels.mjs';

const DEFAULT_SUBJECT = `New video on ${BRAND_NAME}`;
const MAX_ATTEMPTS = 8;

// Links open the clip on its kid's channel; a clip announced before channels existed keeps the old form,
// which the viewer resolves through /api/clips/locate.
function watchLink(clip, siteUrl) {
  const slug = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(clip.channel || '') ? `c/${clip.channel}/` : '';
  return new URL(`/#/${slug}v/${encodeURIComponent(clip.id)}`, siteUrl).href;
}

// A time capsule that just opened (capsule_note is set, even to '') gets its own subject and the note.
const capsuleSubject = clip => `A time capsule just opened on ${clip.channel_name ? `${clip.channel_name}'s channel` : BRAND_NAME}`;

export function videoEmail(clip, { siteUrl, unsubscribeUrl }) {
  const watchUrl = watchLink(clip, siteUrl);
  const capsule = clip.capsule_note != null;
  const SUBJECT = capsule ? capsuleSubject(clip) : DEFAULT_SUBJECT;
  const seconds = Math.max(0, Math.round(Number(clip.duration) || 0));
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const posted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(clip.published));
  const joke = capsule ? `It was sealed until now.${clip.capsule_note ? ` "${clip.capsule_note}"` : ''}` : 'A new video is ready on your family channel.';
  const text = `${SUBJECT}\n\n${joke}\n\n${clip.title}\nLength: ${duration}\nPosted: ${posted} (UTC)${clip.blurb ? `\n${clip.blurb}` : ''}\n\nWatch the new vid: ${watchUrl}\n\nLog in with your ${BRAND_NAME} account to watch.\n\nYou received this because you have an approved ${BRAND_NAME} account.\nStop new-video emails: ${unsubscribeUrl}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(SUBJECT)}</title></head>
<body style="margin:0;background:#0B0C10;color:#F7F4EC;font-family:Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(clip.title)} · A new moment to share.</div>
<main style="max-width:560px;margin:0 auto;padding:32px 24px">
  <p style="color:${DEFAULT_ACCENT};letter-spacing:3px;font-size:12px;font-weight:bold">${WORDMARK}</p>
  <h1 style="font-size:30px;line-height:1.2">${escapeHtml(SUBJECT)}</h1>
  <p style="line-height:1.6">${escapeHtml(joke)}</p>
  <div style="border:1px solid #44404A;border-radius:10px;padding:20px;margin:24px 0">
    <h2 style="font-size:22px;margin:0 0 12px">${escapeHtml(clip.title)}</h2>
    <p style="color:#C4BEC9;font-size:14px;margin:0;line-height:1.7">Length: ${duration}<br>Posted: ${escapeHtml(posted)} (UTC)</p>
    ${clip.blurb ? `<p style="line-height:1.6">${escapeHtml(clip.blurb)}</p>` : ''}
  </div>
  <p style="margin:28px 0"><a href="${escapeHtml(watchUrl)}" style="display:inline-block;background:${DEFAULT_ACCENT};color:#0B0C10;padding:14px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Watch the new vid</a></p>
  <p style="line-height:1.6">Log in with your ${BRAND_NAME} account to watch.</p>
  <p style="color:#A6A0AE;font-size:12px;line-height:1.7;margin-top:32px">You received this because you have an approved ${BRAND_NAME} account.<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:#C4BEC9">Stop new-video emails</a></p>
</main></body></html>`;
  return { subject: SUBJECT, html, text };
}

export function createVideoNotifications({ sqlite, env, fetchImpl = fetch, now = Date.now, logger = console }) {
  // Read on every use: on a first install the setup wizard saves the web address after the app started.
  const site = () => {
    const url = new URL(env.SITE_URL || 'http://localhost:3000');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('SITE_URL must be an HTTP(S) URL');
    return url;
  };
  site();
  let timer = null, running = null, stopped = false;

  // Called inside the upload's publication transaction. Never scan old clips on startup.
  function enqueue(clip) {
    if (env.MAIL_MODE==='disabled' || (clip.kind && clip.kind !== 'video')) return;
    const added = sqlite.prepare(`INSERT OR IGNORE INTO video_announcements
      (clip_id,title,blurb,duration,published,created,channel_id,capsule_note) VALUES (?,?,?,?,?,?,?,?)`)
      .run(clip.id, clip.title, clip.blurb || '', Number(clip.duration) || 0, clip.publishedAt || clip.published, now(), clip.channelId ?? DEFAULT_CHANNEL_ID,
        clip.capsule ? String(clip.capsuleNote || '') : null).changes;
    if (!added) return;
    const recipients = sqlite.prepare(`SELECT email FROM accounts WHERE status='approved'
      AND NOT EXISTS (SELECT 1 FROM video_email_preferences p WHERE p.email=accounts.email AND p.unsubscribed=1)`).all();
    const insert = sqlite.prepare(`INSERT OR IGNORE INTO video_notification_deliveries
      (clip_id,email,delivery_key,next_attempt) VALUES (?,?,?,?)`);
    for (const { email } of recipients) insert.run(clip.id, email, randomUUID(), now());
  }

  function signature(email) {
    return createHmac('sha256', env.SIGN_SECRET).update(`video-email-unsubscribe|${email}`).digest('hex');
  }

  function unsubscribeLink(email) {
    const url = new URL('/api/notifications/unsubscribe', site());
    url.searchParams.set('e', Buffer.from(email).toString('base64url'));
    url.searchParams.set('s', signature(email));
    return url.href;
  }

  function preferencesPage(message, { status = 200, action } = {}) {
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${BRAND_NAME} email settings</title></head>
<body style="background:#0B0C10;color:#F7F4EC;font:16px/1.6 Arial,sans-serif;margin:0"><main style="max-width:480px;margin:50px auto;padding:24px">
<p style="color:${DEFAULT_ACCENT};letter-spacing:3px">${WORDMARK}</p><h1>New-video emails</h1><p>${escapeHtml(message)}</p>
${action ? `<form method="post" action="${escapeHtml(action)}"><button style="background:${DEFAULT_ACCENT};color:#0B0C10;border:0;border-radius:6px;padding:12px 18px;font:inherit;font-weight:bold;cursor:pointer" type="submit">Stop new-video emails</button></form>` : ''}
<p><a href="${escapeHtml(new URL('/', site()).href)}" style="color:${DEFAULT_ACCENT}">Back to ${BRAND_NAME}</a></p></main></body></html>`, {
      status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" },
    });
  }

  function handleUnsubscribe(request) {
    if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers: { allow: 'GET, POST' } });
    const url = new URL(request.url);
    const email = Buffer.from(url.searchParams.get('e') || '', 'base64url').toString('utf8');
    const supplied = url.searchParams.get('s') || '';
    if (!email || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(signature(email), 'hex'))) {
      return preferencesPage(`This email settings link is invalid. Use the link in your latest ${BRAND_NAME} email.`, { status: 403 });
    }
    // GET only shows a confirmation so email link scanners cannot unsubscribe people.
    if (request.method === 'GET') return preferencesPage('Want fewer emails? You can stop new-video emails and keep your account.', { action: url.pathname + url.search });
    sqlite.prepare(`INSERT INTO video_email_preferences (email,unsubscribed) VALUES (?,1)
      ON CONFLICT(email) DO UPDATE SET unsubscribed=1`).run(email);
    sqlite.prepare("UPDATE video_notification_deliveries SET status='skipped', last_error='Unsubscribed' WHERE email=? AND status='pending'").run(email);
    return preferencesPage(`You have stopped new-video emails. Your ${BRAND_NAME} account still works.`);
  }

  async function drain() {
    while (!stopped) {
      const row = sqlite.prepare(`SELECT d.*, a.title, a.blurb, a.duration, a.published, a.capsule_note, ch.slug AS channel, ch.name AS channel_name FROM video_notification_deliveries d
        JOIN video_announcements a ON a.clip_id=d.clip_id LEFT JOIN channels ch ON ch.id=a.channel_id
        WHERE d.status='pending' AND d.next_attempt<=? ORDER BY d.next_attempt, d.rowid LIMIT 1`).get(now());
      if (!row) return;
      const account = sqlite.prepare('SELECT status FROM accounts WHERE email=?').get(row.email);
      const clip = sqlite.prepare('SELECT hidden, review FROM clips WHERE id=?').get(row.clip_id);
      const preference = sqlite.prepare('SELECT unsubscribed FROM video_email_preferences WHERE email=?').get(row.email);
      if (account?.status !== 'approved' || !clip || clip.hidden || clip.review !== 'approved' || preference?.unsubscribed) {
        sqlite.prepare("UPDATE video_notification_deliveries SET status='skipped', last_error='Account or clip no longer eligible' WHERE clip_id=? AND email=?")
          .run(row.clip_id, row.email);
        continue;
      }
      const attempts = row.attempts + 1;
      sqlite.prepare('UPDATE video_notification_deliveries SET attempts=? WHERE clip_id=? AND email=?').run(attempts, row.clip_id, row.email);
      try {
        const message = videoEmail({ ...row, id: row.clip_id }, { siteUrl: site(), unsubscribeUrl: unsubscribeLink(row.email) });
        const result = await sendMail(env, { email: row.email }, message.subject, message.html, message.text, { idempotencyKey: row.delivery_key, fetchImpl });
        sqlite.prepare("UPDATE video_notification_deliveries SET status='sent', sent=?, message_id=?, last_error=NULL WHERE clip_id=? AND email=?")
          .run(now(), result.messageId || null, row.clip_id, row.email);
      } catch (error) {
        const permanent = error.status >= 400 && error.status < 500 && ![401, 403, 408, 429].includes(error.status);
        const failed = permanent || attempts >= MAX_ATTEMPTS;
        const delay = Math.max(Math.min(60000 * 2 ** (attempts - 1), 3600000), error.retryAfter || 0);
        sqlite.prepare('UPDATE video_notification_deliveries SET status=?, next_attempt=?, last_error=? WHERE clip_id=? AND email=?')
          .run(failed ? 'failed' : 'pending', now() + delay, String(error.message).slice(0, 180), row.clip_id, row.email);
        logger.error(`Video notification ${failed ? 'failed' : 'will retry'} for clip ${row.clip_id}: ${error.message}`);
      }
    }
  }

  function schedule() {
    if (stopped || running) return;
    clearTimeout(timer);
    const next = sqlite.prepare("SELECT MIN(next_attempt) AS at FROM video_notification_deliveries WHERE status='pending'").get().at;
    if (next === null) return;
    timer = setTimeout(kick, Math.max(0, Math.min(next - now(), 2147483647)));
    timer.unref();
  }

  function kick() {
    if (stopped) return Promise.resolve();
    if (running) return running;
    clearTimeout(timer);
    running = drain().catch(error => logger.error('Video notification queue failed:', error))
      .finally(() => { running = null; schedule(); });
    return running;
  }

  async function close() {
    stopped = true;
    clearTimeout(timer);
    await running;
  }

  return { enqueue, kick, close, handleUnsubscribe };
}
