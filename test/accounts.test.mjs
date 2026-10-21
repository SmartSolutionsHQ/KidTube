import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordRecord } from '../server/passwords.mjs';
import { startInstall, PARENT } from './helpers.mjs';

const b64 = text => Buffer.from(text).toString('base64url');

test('sign-in endpoints do not reveal which emails have accounts', { timeout: 30000 }, async t => {
  const install = await startInstall(t);
  const { salt, hash } = await passwordRecord('A-pending-test-password!');
  install.db.prepare(`INSERT INTO accounts (email,first,last,salt,hash,status,role,created)
    VALUES ('waiting@example.com','Wait','Ing',?,?,'pending','',0)`).run(salt, hash);

  await t.test('login gives the same answer for an unknown email and a wrong password', async () => {
    const unknown = await install.call('/api/login', { body: { email: 'nobody@example.com', pass: 'whatever-password' } });
    const wrong = await install.call('/api/login', { body: { email: PARENT.email, pass: 'whatever-password' } });
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, unknown.status);
    assert.equal(await wrong.text(), await unknown.text());
    assert.equal(unknown.headers.get('set-cookie'), null);
    assert.equal(wrong.headers.get('set-cookie'), null);
  });

  await t.test('/api/check reveals nothing without a valid session token', async () => {
    const parent = await install.login(PARENT);
    const probes = [
      '/api/check?e=' + b64('nobody@example.com'),
      '/api/check?e=' + b64(PARENT.email),
      '/api/check?e=' + b64('waiting@example.com'),
      '/api/check?e=' + b64(PARENT.email) + '&t=' + encodeURIComponent(parent.t.replace(/.$/, c => c === '0' ? '1' : '0')),
      '/api/check?e=' + b64('nobody@example.com') + '&t=' + encodeURIComponent(parent.t),
      '/api/check?e=%%%',
      '/api/check',
    ];
    const answers = [];
    for (const path of probes) {
      const response = await install.call(path);
      assert.equal(response.headers.get('set-cookie'), null, path);
      answers.push([response.status, await response.text()]);
    }
    for (const answer of answers) assert.deepEqual(answer, answers[0]);
    assert.deepEqual(JSON.parse(answers[0][1]), { ok: true, status: 'none', role: '' });

    const valid = await install.call('/api/check?e=' + b64(PARENT.email) + '&t=' + encodeURIComponent(parent.t));
    assert.deepEqual(await valid.json(), { ok: true, email: PARENT.email, status: 'approved', role: 'super', t: parent.t });
    assert.match(valid.headers.get('set-cookie'), /^kid_access=.*HttpOnly/);
  });

  await t.test('login returns the canonical email and the cookie follows it', async () => {
    const response = await install.call('/api/login', { body: { email: '  Parent@Example.COM ', pass: PARENT.pass } });
    const json = await response.json();
    assert.equal(json.email, PARENT.email);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const viewer = JSON.parse(Buffer.from(cookie.slice('kid_access='.length).split('.')[0], 'base64url'));
    assert.equal(viewer.email, PARENT.email);
    assert.equal((await install.call('/api/clips', { cookie })).status, 200);
  });

  await t.test('the retired PIN admin and database upload endpoints are gone', async () => {
    for (const path of ['/api/admin', '/api/admin/act', '/api/admin/list', '/api/upload/init', '/api/clips/create', '/api/upload/chunk/abcdefgh/0']) {
      assert.equal((await install.call(path, { body: {} })).status, 404, path);
    }
  });
});
