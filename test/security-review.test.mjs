// Regressions for docs/plan/security-review.md: each test names the finding it pins down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addressKey, clientIp } from '../server/setup.mjs';
import { startInstall, PARENT } from './helpers.mjs';
import { startFamily, KID, KID_EMAIL } from './family-fixture.mjs';

const fakeReq = (forwarded, remote = '10.0.0.9') => ({ headers: forwarded ? { 'x-forwarded-for': forwarded } : {}, socket: { remoteAddress: remote } });

test('H1: behind a trusted proxy, limits count the address the proxy saw, not what the client wrote', t => {
  const before = process.env.TRUST_PROXY;
  t.after(() => { if (before === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = before; });
  process.env.TRUST_PROXY = '1';
  // nginx's $proxy_add_x_forwarded_for appends the real address after whatever the client sent.
  assert.equal(clientIp(fakeReq('198.51.100.1, 203.0.113.7')), '203.0.113.7');
  assert.equal(clientIp(fakeReq('anything-at-all, 203.0.113.7')), clientIp(fakeReq('203.0.113.7')));
  delete process.env.TRUST_PROXY;
  assert.equal(clientIp(fakeReq('198.51.100.1')), '10.0.0.9', 'without TRUST_PROXY the header is ignored');
});

test('M2: IPv6 addresses in one /64 share a limit, and IPv4-mapped addresses read as IPv4', () => {
  assert.equal(addressKey('2001:db8:1:2:aaaa::1'), addressKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'));
  assert.notEqual(addressKey('2001:db8:1:2::1'), addressKey('2001:db8:1:3::1'));
  assert.equal(addressKey('2001:0db8:0001:0002::1'), '2001:db8:1:2::/64');
  assert.equal(addressKey('::1'), '0:0:0:0::/64');
  assert.equal(addressKey('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(addressKey('203.0.113.7'), '203.0.113.7');
  assert.equal(addressKey(undefined), 'unknown');
});

test('H1/M2: rate limits hold against a changing X-Forwarded-For and against many addresses', { timeout: 60000 }, async t => {
  const install = await startFamily(t, { TRUST_PROXY: '1' });
  const login = (email, pass, from) => install.call('/api/login', { body: { email, pass }, headers: { 'x-forwarded-for': from } });

  await t.test('a client inventing a new first X-Forwarded-For entry each try still meets the address limit', async () => {
    const statuses = [];
    for (let i = 0; i < 25; i++) statuses.push((await login('nobody@example.com', 'wrong-' + i, `198.51.100.${i}, 203.0.113.7`)).status);
    assert.ok(statuses.includes(429), `no 429 in ${statuses.join(',')}`);
  });

  await t.test('ten wrong passwords for one kid, from ten addresses, pause that login', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await login(KID.email, 'wrong-guess-' + i, `192.0.2.${i}`)).status, 401);
    const right = await login(KID.email, KID.pass, '192.0.2.99');
    assert.equal(right.status, 429, 'even the right password waits');
    assert.equal(install.db.prepare('SELECT status FROM accounts WHERE email=?').get(KID_EMAIL).status, 'approved');
    // Other accounts are unaffected.
    assert.equal((await login(PARENT.email, PARENT.pass, '192.0.2.98')).status, 200);
  });

  await t.test('guest codes are six characters, and wrong codes from many addresses pause redeeming', async () => {
    const parent = await install.login(PARENT);
    const made = await (await install.call('/api/guest/generate', { body: { email: PARENT.email, t: parent.t } })).json();
    assert.match(made.code, /^[A-HJ-NP-Z2-9]{6}$/);
    const statuses = [];
    for (let i = 0; i < 35; i++) {
      statuses.push((await install.call('/api/guest/redeem', { body: { code: 'ZZZZZ' + (i % 8 + 2) }, headers: { 'x-forwarded-for': `192.0.2.${100 + i}` } })).status);
    }
    assert.deepEqual([...new Set(statuses.slice(0, 30))], [400]);
    assert.deepEqual([...new Set(statuses.slice(30))], [429]);
  });
});

test('H1: a fresh install without a proxy keeps the per-address login limit', { timeout: 30000 }, async t => {
  const install = await startInstall(t);
  const statuses = [];
  for (let i = 0; i < 22; i++) statuses.push((await install.call('/api/login', { body: { email: `n${i}@example.com`, pass: 'x' } })).status);
  assert.equal(statuses.at(-1), 429);
});

test('M1: co-parents can review and moderate, but watch history, people, tapes and badges stay with the owner', { timeout: 60000 }, async t => {
  const family = await startFamily(t);
  const { json, parent, coparent, staffQuery } = family;
  const as = who => ({ email: who.email, t: who.t });
  const spec = { v: 1, shape: 'star', bg: '#FF5C2B', text: { value: 'TOBI', font: 'anton', color: '#0B0C10' } };
  const routes = [
    ['GET', '/api/admin/views', who => ({ path: `/api/admin/views?${staffQuery(who)}` })],
    ['GET', '/api/admin/budget', who => ({ path: `/api/admin/budget?target=tobi%40kids.invalid&${staffQuery(who)}` })],
    ['POST', '/api/admin/budget', who => ({ body: { ...as(who), target: KID_EMAIL, minutes: 30 } })],
    ['POST', '/api/admin/budget/bonus', who => ({ body: { ...as(who), target: KID_EMAIL, minutes: 15 } })],
    ['POST', '/api/admin/timezone', who => ({ body: { ...as(who), timezone: 'UTC' } })],
    ['PUT', '/api/admin/channels/1/badge', who => ({ method: 'PUT', body: { ...as(who), spec } })],
    ['PUT', '/api/admin/brand/badge', who => ({ method: 'PUT', body: { ...as(who), spec } })],
  ];
  const call = (who, path, make) => { const { path: p = path, ...options } = make(who); return json(p, options); };
  for (const [method, path, make] of routes) assert.equal((await call(coparent, path, make)).status, 403, `co-parent ${method} ${path}`);
  // The owner still can (the bonus needs a daily tape, which the budget route just before it sets).
  for (const [method, path, make] of routes) assert.equal((await call(parent, path, make)).status, 200, `owner ${method} ${path}`);
  // The overview keeps the co-parent's review work but not the people list or anyone's email.
  const mine = await json(`/api/admin/overview?${staffQuery(coparent)}`);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.accounts, []);
  assert.ok(mine.body.clips.length > 0);
  assert.ok(!JSON.stringify(mine.body).includes('@'), 'no email addresses for a co-parent');
  assert.ok((await json(`/api/admin/overview?${staffQuery(parent)}`)).body.accounts.length >= 4);
});
