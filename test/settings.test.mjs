import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initializeSchema } from '../server/schema.mjs';
import { BRAND_NAME, TAGLINE } from '../server/brand.mjs';
import { createSettings, SettingError, SETTING_KEYS } from '../server/settings.mjs';
import { createVideoNotifications, videoEmail } from '../server/notifications.mjs';

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  initializeSchema(sqlite);
  return sqlite;
}

test('settings fall back to defaults, then the database, then the environment', t => {
  const sqlite = database(t);
  const settings = createSettings(sqlite, {});
  assert.deepEqual(settings.all(), {
    familyName: '', tagline: TAGLINE, gateTheme: 'ember-tape', accent: '#FF5C2B',
    kidsPublic: true, signups: true, guestCodes: true, reviewComments: false,
  });
  assert.deepEqual(Object.keys(settings.all()), SETTING_KEYS);
  assert.equal(settings.set('familyName', '  The Rivera Family '), 'The Rivera Family');
  assert.equal(settings.set('kidsPublic', false), false);
  assert.equal(createSettings(sqlite, {}).get('kidsPublic'), false, 'saved choices survive a restart');

  const overridden = createSettings(sqlite, { KIDS_PUBLIC: 'yes', FAMILY_NAME: 'Env Family', ACCENT: '' });
  assert.equal(overridden.get('kidsPublic'), true);
  assert.equal(overridden.get('familyName'), 'Env Family');
  assert.equal(overridden.get('accent'), '#FF5C2B', 'an empty variable counts as unset');
  assert.equal(overridden.locked('kidsPublic'), true);
  assert.equal(overridden.locked('accent'), false);
  overridden.set('familyName', 'Saved Family');
  assert.equal(overridden.get('familyName'), 'Env Family', 'the environment keeps winning');
  assert.equal(createSettings(sqlite, {}).get('familyName'), 'Saved Family');
});

test('settings reject bad values and survive a corrupt row', t => {
  const sqlite = database(t);
  const settings = createSettings(sqlite, {});
  assert.throws(() => settings.set('accent', 'red'), SettingError);
  assert.throws(() => settings.set('kidsPublic', 'sometimes'), SettingError);
  assert.throws(() => settings.set('familyName', 'x'.repeat(61)), SettingError);
  assert.throws(() => settings.set('brand', 'Other'), /Unknown setting/);
  assert.throws(() => settings.get('constructor'), /Unknown setting/);
  assert.throws(() => createSettings(sqlite, { KIDS_PUBLIC: 'maybe' }), /KIDS_PUBLIC/);
  sqlite.prepare("INSERT INTO settings VALUES ('accent','\"not a color\"',0)").run();
  const errors = console.error;
  console.error = () => {};
  try { assert.equal(settings.get('accent'), '#FF5C2B'); } finally { console.error = errors; }
});

test('server copy uses the brand name from settings', async t => {
  const sqlite = database(t);
  const env = { SIGN_SECRET: 'test-secret', SITE_URL: 'https://tube.example.com', MAIL_MODE: 'disabled' };
  const message = videoEmail({ id: 'clip', title: 'Clip', duration: 3, published: '2026-10-21T00:00:00Z' },
    { siteUrl: env.SITE_URL, unsubscribeUrl: 'https://tube.example.com/unsubscribe' });
  const notifications = createVideoNotifications({ sqlite, env });
  t.after(() => notifications.close());
  const page = notifications.handleUnsubscribe(new Request('https://tube.example.com/api/notifications/unsubscribe?e=x&s=y'));
  assert.equal(page.status, 403);
  for (const copy of [message.subject, message.text, message.html, await page.text()]) {
    assert.ok(copy.includes(BRAND_NAME));
    assert.ok(!copy.includes('${'), 'every template placeholder is filled');
  }
});
