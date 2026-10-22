import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { rmSync, writeFileSync, chmodSync } from 'node:fs';
import { isIP } from 'node:net';
import { accountCookie, viewer } from './access.mjs';
import { isEmail, sessToken } from './api.js';
import { BRAND_NAME, ENDORSEMENT } from './brand.mjs';
import { checkSiteUrl, InstallError } from './config.mjs';
import { FamilyError } from './family.mjs';
import { HttpError, headerStaff, readJson, sendJson } from './jsonio.mjs';
import { sendMail } from './mail.mjs';
import { PASSWORD_MAX, PASSWORD_MIN, passwordRecord } from './passwords.mjs';
import { SettingError } from './settings.mjs';

// Setup mode: until an owner (role 'super') exists, the app only serves the wizard. A one-time code
// printed at boot and written to DATA_DIR/setup-token proves the person claiming the install can see
// the server. After the claim, every wizard step uses the owner's normal session.

// Crockford's base32: no I, L, O or U. People still type O for 0 and I or L for 1, so input is folded
// back before comparing. 20 symbols of 5 bits each make 100 bits.
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS = 4, GROUP = 5;
const FAIL_WINDOW = 10 * 60 * 1000;
const FAILS_PER_IP = 5;
const FAILS_TOTAL = 30;
// While there is no owner these still answer; every other API says 503 {setup:true}.
const OPEN_APIS = new Set(['/api/health', '/api/site', '/api/themes']);
const PAGES = new Set(['/', '/parents', '/about']);
export const STEPS = 7;

export function newCode() {
  const symbols = Array.from({ length: GROUPS * GROUP }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return 'KT-' + symbols.match(new RegExp(`.{${GROUP}}`, 'g')).join('-');
}

// "kt 7qmx0-..." and "KT-7QMXO-..." both become the 20 symbols that were printed.
export function normalizeCode(input) {
  const raw = String(input || '').toUpperCase().replace(/[\s-]/g, '').replace(/^KT/, '');
  return raw.replace(/O/g, '0').replace(/[IL]/g, '1');
}

const digest = text => createHash('sha256').update(text).digest();

// The address every rate limit counts by. index.mjs and api.js use it too, so no limit can be skipped by
// sending a made-up X-Forwarded-For.
export function clientIp(req) {
  if (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-for']) {
    // The trusted proxy appends the address it saw, so the last entry is the one to believe.
    return addressKey(String(req.headers['x-forwarded-for']).split(',').pop());
  }
  return addressKey(req.socket.remoteAddress);
}

// One IPv6 client usually holds a whole /64, so those addresses count as one.
export function addressKey(ip) {
  const text = String(ip || '').trim().toLowerCase();
  if (!text) return 'unknown';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (mapped) return mapped[1];
  if (!text.includes(':')) return text;
  const [head, tail] = text.split('%')[0].split('::');
  const left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return groups.slice(0, 4).map(group => group.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

// The origin a browser on this request would send: the socket's scheme (or the trusted proxy's) and Host.
function requestOrigin(req) {
  const forwarded = process.env.TRUST_PROXY === '1' && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwarded === 'https' || forwarded === 'http' ? forwarded : req.socket.encrypted ? 'https' : 'http';
  return req.headers.host ? `${proto}://${req.headers.host}` : '';
}

export function createSetup({ sqlite, settings, env, paths, family, sendFile, log = console.log }) {
  let codeHash = null;
  let killed = false;
  let failures = 0;
  const failed = new Map();

  const ownerExists = () => !!sqlite.prepare("SELECT 1 FROM accounts WHERE role='super' LIMIT 1").get();
  // Setup mode lasts from a boot without an owner until the first owner exists. It never comes back
  // in a running process (say, if the only owner were demoted), because only a boot prints a code.
  let owned = false;
  const unclaimed = () => !(owned ||= ownerExists());
  const complete = () => settings.get('setup_complete') === true;
  const locked = key => settings.describe().find(entry => entry.key === key)?.locked === true;
  const activity = (actor, subject, detail) => sqlite.prepare("INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (?,?,'setup',?,?)")
    .run(Date.now(), actor, subject, JSON.stringify(detail));
  const forgetToken = () => rmSync(paths.tokenFile, { force: true });

  // A new code on every start until someone claims the install.
  let code = null;
  if (unclaimed()) {
    code = newCode();
    codeHash = digest(normalizeCode(code));
    writeFileSync(paths.tokenFile, code + '\n', { mode: 0o600 });
    chmodSync(paths.tokenFile, 0o600);
  } else {
    forgetToken();
  }

  // Printed once the server listens, where `docker logs` and the terminal show it.
  function announce(port) {
    const base = settings.get('site_url') || `http://localhost:${process.env.HOST_PORT || port}`;
    if (code && unclaimed()) {
      log(['Ready for setup.', `Open ${base}/setup`, `Setup code: ${code}`,
        'The code works once and changes every restart until setup is done.',
        `It is also saved in ${paths.tokenFile}.`].join('\n'));
    } else if (!complete()) {
      log(`Setup is not finished. Sign in as the parent at ${base}/setup to finish it.`);
    }
  }

  // Guesses: 5 wrong per address per 10 minutes, and 30 wrong in all retire the code until a restart.
  function recent(ip) {
    const now = Date.now();
    const list = (failed.get(ip) || []).filter(at => at > now - FAIL_WINDOW);
    if (list.length) failed.set(ip, list); else failed.delete(ip);
    return list;
  }
  function gate(ip) {
    if (!killed && !codeHash) throw new HttpError(409, 'Someone else just finished this step. Sign in instead.');
    if (killed) throw new HttpError(423, 'This setup code was turned off after too many wrong tries. Restart the app to get a new code.');
    if (recent(ip).length >= FAILS_PER_IP) throw new HttpError(429, 'Too many wrong codes from this device. Wait ten minutes and try again.');
  }
  function checkCode(ip, input) {
    gate(ip);
    const normalized = normalizeCode(input);
    if (normalized.length === GROUPS * GROUP && timingSafeEqual(digest(normalized), codeHash)) return;
    const list = recent(ip);
    list.push(Date.now());
    failed.set(ip, list);
    if (++failures >= FAILS_TOTAL) {
      killed = true;
      codeHash = null;
      forgetToken();
      log('The setup code was turned off after too many wrong tries. Restart the app to get a new one.');
    }
    throw new HttpError(403, "That code doesn't match. Check it against the newest one in the log; it changes every restart.");
  }

  async function owner(req) {
    const staff = await headerStaff(env, req);
    if (staff?.role !== 'super') throw new HttpError(401, 'Sign in as the parent who set this up.');
    return staff.email;
  }

  function saveSettings(values, actor) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined || locked(key)) continue;
      settings.set(key, value, actor);
    }
  }

  const step = (actor, number) => activity(actor, 'step', { step: number });
  const reached = () => {
    const rows = sqlite.prepare("SELECT detail FROM activity WHERE kind='setup' AND subject='step'").all();
    return rows.reduce((max, row) => { try { return Math.max(max, Number(JSON.parse(row.detail).step) || 0); } catch { return max; } }, 2);
  };

  function ownerState(email) {
    const account = sqlite.prepare('SELECT first, last FROM accounts WHERE email=?').get(email) || {};
    const all = settings.all();
    return {
      owner: { email, first: account.first || '', last: account.last || '' },
      reached: Math.min(STEPS, reached() + 1),
      family: {
        name: all.site_name, tagline: all.site_tagline, siteUrl: all.site_url, accent: all.family_accent, badge: all.family_badge,
        locked: { name: locked('site_name'), tagline: locked('site_tagline'), siteUrl: locked('site_url') },
      },
      kids: family.listKids(),
      watch: {
        kidsPublic: all.kids_public, signupMode: all.signup_mode, guestPasses: all.guest_passes, comments: all.comments_default,
        locked: { kidsPublic: locked('kids_public'), signupMode: locked('signup_mode'), guestPasses: locked('guest_passes'), comments: locked('comments_default') },
      },
      email: {
        mode: all.mail_mode, keySet: !!all.brevo_api_key, sender: all.sender_email, notify: all.notify_email,
        locked: locked('mail_mode') || locked('brevo_api_key') || locked('sender_email') || locked('notify_email'),
      },
    };
  }

  async function state(req) {
    const base = {
      ok: true, brand: { name: BRAND_NAME, endorsement: ENDORSEMENT }, steps: STEPS,
      // Not the token file's path: anyone can ask this before the claim, and the path names the data folder.
      production: process.env.NODE_ENV === 'production', origin: requestOrigin(req), docker: paths.dataDir === '/data',
    };
    if (unclaimed()) return { ...base, stage: 'code', disabled: killed || !codeHash };
    let email = null;
    try { email = await owner(req); } catch {}
    if (!email) return { ...base, stage: complete() ? 'finished' : 'signin' };
    return { ...base, stage: complete() ? 'done' : 'wizard', ...ownerState(email) };
  }

  async function claim(req, res) {
    if (!unclaimed()) throw new HttpError(410, 'This install already has a parent account. Sign in instead.');
    const ip = clientIp(req);
    gate(ip);
    const body = await readJson(req);
    checkCode(ip, body.code);
    const first = String(body.first || '').trim().slice(0, 40);
    const last = String(body.last || '').trim().slice(0, 40);
    const email = String(body.email || '').trim().toLowerCase();
    if (!first) throw new HttpError(400, 'Add your first name.');
    if (!isEmail(email)) throw new HttpError(400, 'Use your email address.');
    if (typeof body.pass !== 'string' || body.pass.length < PASSWORD_MIN || body.pass.length > PASSWORD_MAX) throw new HttpError(400, `Use a password of ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`);
    const record = await passwordRecord(body.pass);
    // Two people with the code may press Continue at once; the write lock lets exactly one win.
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      if (ownerExists()) { sqlite.exec('ROLLBACK'); throw new HttpError(409, 'Someone else just finished this step. Sign in instead.'); }
      sqlite.prepare(`INSERT INTO accounts (email,first,last,salt,hash,status,role,created) VALUES (?,?,?,?,?,'approved','super',?)
        ON CONFLICT(email) DO UPDATE SET first=excluded.first, last=excluded.last, salt=excluded.salt, hash=excluded.hash,
        status='approved', role='super', channel_id=NULL`).run(email, first, last, record.salt, record.hash, Date.now());
      // Who claimed it, not from where: the address would sit in the activity log for a year.
      activity(email, 'claim', {});
      step(email, 2);
      sqlite.exec('COMMIT');
    } catch (error) {
      if (sqlite.isTransaction) sqlite.exec('ROLLBACK');
      throw error;
    }
    codeHash = null;
    code = null;
    forgetToken();
    log(`Setup claimed by ${email}.`);
    sendJson(res, 200, { ok: true, t: await sessToken(env, email), email, role: 'super' }, { 'Set-Cookie': accountCookie(env, sqlite, email) });
  }

  async function saveFamily(req, res) {
    const actor = await owner(req);
    const body = await readJson(req);
    const name = String(body.name ?? '').trim();
    if (!name && !locked('site_name')) throw new HttpError(400, 'Add a family name.');
    let siteUrl;
    if (!locked('site_url') && body.siteUrl !== undefined) {
      try { siteUrl = new URL(String(body.siteUrl)).origin; } catch { throw new HttpError(400, 'Use a web address like https://videos.example.com.'); }
      try { checkSiteUrl(siteUrl); } catch (error) { if (error instanceof InstallError) throw new HttpError(400, error.message); throw error; }
    }
    saveSettings({ site_name: name, site_tagline: body.tagline === undefined ? undefined : String(body.tagline), site_url: siteUrl }, actor);
    step(actor, 3);
    sendJson(res, 200, { ok: true, siteUrl: settings.get('site_url') });
  }

  async function saveKid(req, res) {
    const actor = await owner(req);
    const kid = await family.saveKid(await readJson(req), actor);
    sendJson(res, 200, { ok: true, kid, kids: family.listKids() });
  }

  async function removeKid(req, res, id) {
    const actor = await owner(req);
    await family.removeKid(id, actor);
    sendJson(res, 200, { ok: true, kids: family.listKids() });
  }

  async function kidsDone(req, res) {
    const actor = await owner(req);
    if (family.listKids().every(kid => kid.placeholder)) throw new HttpError(400, 'Add at least one kid first.');
    step(actor, 4);
    sendJson(res, 200, { ok: true });
  }

  async function saveWatch(req, res) {
    const actor = await owner(req);
    const body = await readJson(req);
    saveSettings({ kids_public: body.kidsPublic, signup_mode: body.signupMode, guest_passes: body.guestPasses, comments_default: body.comments }, actor);
    step(actor, 5);
    sendJson(res, 200, { ok: true });
  }

  async function saveEmail(req, res) {
    const actor = await owner(req);
    const body = await readJson(req);
    if (body.mode === 'brevo') {
      const key = String(body.key || '').trim();
      if (!key && !settings.get('brevo_api_key')) throw new HttpError(400, 'Paste your Brevo API key.');
      for (const [field, label] of [['sender', 'the sender address'], ['notify', 'where to send notices']]) {
        if (!isEmail(String(body[field] || '').trim())) throw new HttpError(400, `Add ${label}.`);
      }
      saveSettings({ brevo_api_key: key || undefined, sender_email: body.sender, notify_email: body.notify, mail_mode: 'brevo' }, actor);
    } else {
      saveSettings({ mail_mode: 'disabled' }, actor);
    }
    step(actor, 6);
    sendJson(res, 200, { ok: true, mode: settings.get('mail_mode') });
  }

  async function testEmail(req, res) {
    await owner(req);
    if (settings.get('mail_mode') !== 'brevo') throw new HttpError(400, 'Save your email settings first.');
    const to = settings.get('notify_email');
    try {
      await sendMail(env, { email: to }, `${BRAND_NAME} test email`,
        `<p>This is a test from ${BRAND_NAME}. Email works.</p>`, `This is a test from ${BRAND_NAME}. Email works.`);
    } catch (error) {
      console.error('Test email failed:', error);
      throw new HttpError(502, `The email service said no${error.status ? ` (HTTP ${error.status})` : ''}. Check the key and that the sender address is verified in Brevo.`);
    }
    sendJson(res, 200, { ok: true, to });
  }

  async function finish(req, res) {
    const actor = await owner(req);
    if (!complete()) {
      settings.set('setup_complete', true, actor);
      step(actor, 7);
      log('Setup is finished.');
    }
    sendJson(res, 200, { ok: true });
  }

  async function verify(req, res) {
    if (!unclaimed()) throw new HttpError(410, 'This install already has a parent account. Sign in instead.');
    const ip = clientIp(req);
    gate(ip);
    checkCode(ip, (await readJson(req)).code);
    sendJson(res, 200, { ok: true });
  }

  const routes = {
    'GET /api/setup/state': async (req, res) => sendJson(res, 200, await state(req)),
    'POST /api/setup/verify': verify,
    'POST /api/setup/claim': claim,
    'POST /api/setup/family': saveFamily,
    'POST /api/setup/kids': saveKid,
    'POST /api/setup/kids/done': kidsDone,
    'POST /api/setup/watch': saveWatch,
    'POST /api/setup/email': saveEmail,
    'POST /api/setup/email/test': testEmail,
    'POST /api/setup/complete': finish,
  };

  async function api(req, res, pathname) {
    try {
      const kid = /^\/api\/setup\/kids\/([1-9]\d{0,8})$/.exec(pathname);
      if (kid && req.method === 'DELETE') return await removeKid(req, res, Number(kid[1]));
      const route = routes[`${req.method === 'HEAD' ? 'GET' : req.method} ${pathname}`];
      if (!route) throw new HttpError(Object.keys(routes).some(key => key.endsWith(' ' + pathname)) ? 405 : 404, 'Not found.');
      await route(req, res);
    } catch (error) {
      if (res.headersSent) { res.destroy(error); return; }
      if (error instanceof HttpError) return sendJson(res, error.status, { ok: false, error: error.message, ...error.extra });
      if (error instanceof FamilyError) return sendJson(res, error.status, { ok: false, error: error.message });
      if (error instanceof SettingError) return sendJson(res, 400, { ok: false, error: error.message });
      console.error('Setup request failed', error);
      sendJson(res, 500, { ok: false, error: 'Something went wrong. Try again.' });
    }
  }

  // Answers the request and returns true when setup owns it; otherwise the normal routes run.
  function handle(req, res, pathname) {
    if (pathname === '/api/setup' || pathname.startsWith('/api/setup/')) { api(req, res, pathname); return true; }
    if (pathname === '/setup' && (req.method === 'GET' || req.method === 'HEAD')) { sendFile(req, res, '/setup/index.html'); return true; }
    if (unclaimed()) {
      if (PAGES.has(pathname)) { res.writeHead(302, { Location: '/setup', 'Cache-Control': 'no-store' }).end(); return true; }
      if (pathname.startsWith('/api/') && !OPEN_APIS.has(pathname)) {
        sendJson(res, 503, { ok: false, setup: true, error: 'This install is still being set up.' }, { 'Retry-After': '60' });
        return true;
      }
      return false;
    }
    // Claimed but not finished: the parent can look around; everyone else gets a calm notice.
    if (!complete() && PAGES.has(pathname) && (req.method === 'GET' || req.method === 'HEAD')) {
      if (viewer(req, sqlite, env)?.role !== 'super') { sendFile(req, res, '/setup/waiting.html'); return true; }
    }
    return false;
  }

  // Before the family confirms its web address, a request may come from wherever it was opened.
  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    const site = settings.get('site_url');
    return site ? origin === site : origin === requestOrigin(req);
  }

  // DNS rebinding: a page on someone else's domain can point that name at this computer, and the browser then
  // treats the app as part of that page's site. Once the family has a web address, a request must name it, an
  // IP address (a rebinding page always arrives under its own name), localhost, or a name in ALLOWED_HOSTS.
  // Before that, the setup code is the gate.
  function hostAllowed(req) {
    const site = settings.get('site_url');
    if (!site || !req.headers.host) return true;
    let host;
    try { host = new URL(`http://${req.headers.host}`).hostname.toLowerCase(); } catch { return false; }
    if (host === new URL(site).hostname || host === 'localhost' || host.endsWith('.localhost')) return true;
    if (isIP(host.replace(/^\[|\]$/g, ''))) return true;
    return String(process.env.ALLOWED_HOSTS || '').toLowerCase().split(',').map(name => name.trim()).filter(Boolean).includes(host);
  }

  return { handle, originAllowed, hostAllowed, announce, get active() { return unclaimed(); } };
}
