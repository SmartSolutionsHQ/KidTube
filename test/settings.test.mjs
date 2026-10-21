import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../server/schema.mjs';
import { DEFAULT_ACCENT, TAGLINE } from '../server/brand.mjs';
import { createSettings, SettingError, SETTING_KEYS } from '../server/settings.mjs';

async function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  await migrate(sqlite);
  return sqlite;
}

test('settings fall back to defaults, then the database, then the environment', async t => {
  const sqlite = await database(t);
  const settings = createSettings(sqlite, {});
  assert.deepEqual(settings.all(), {
    site_name: '', site_tagline: TAGLINE, site_url: '', family_accent: DEFAULT_ACCENT, gate_theme: 'ember-tape',
    family_badge: null, kids_public: true, signup_mode: 'approval', guest_passes: true, comments_default: 'review',
    review_uploads_default: 'creators', mail_mode: 'disabled', brevo_api_key: '', notify_email: '', sender_email: '',
    splash_sound: true, views_retention_days: 90, activity_retention_days: 365, setup_complete: false,
  });
  assert.deepEqual(Object.keys(settings.all()), SETTING_KEYS);
  assert.equal(settings.set('site_name', '  The Rivera Family ', 'parent@example.com'), 'The Rivera Family');
  assert.equal(settings.set('kids_public', false), false);
  assert.equal(createSettings(sqlite, {}).get('kids_public'), false, 'saved choices survive a restart');

  const overridden = createSettings(sqlite, { KIDS_PUBLIC: 'yes', SITE_NAME: 'Env Family', FAMILY_ACCENT: '', SITE_URL: 'https://tube.example.com/' });
  assert.equal(overridden.get('kids_public'), true);
  assert.equal(overridden.get('site_name'), 'Env Family');
  assert.equal(overridden.get('site_url'), 'https://tube.example.com');
  assert.equal(overridden.get('family_accent'), DEFAULT_ACCENT, 'an empty variable counts as unset');
  overridden.set('site_name', 'Saved Family');
  assert.equal(overridden.get('site_name'), 'Env Family', 'the environment keeps winning');
  assert.equal(createSettings(sqlite, {}).get('site_name'), 'Saved Family');
  const described = Object.fromEntries(overridden.describe().map(row => [row.key, row]));
  assert.deepEqual(described.kids_public, { key: 'kids_public', value: true, source: 'env', locked: true, public: true, secret: false });
  assert.deepEqual(described.site_name.source, 'env');
  assert.deepEqual(described.family_accent.source, 'default');
  assert.equal(createSettings(sqlite, {}).describe().find(row => row.key === 'site_name').source, 'db');
});

test('secrets stay masked and every change is recorded as activity', async t => {
  const sqlite = await database(t);
  const settings = createSettings(sqlite, {});
  settings.set('brevo_api_key', 'xkeysib-secret-value', 'parent@example.com');
  settings.set('guest_passes', false, 'parent@example.com');
  assert.equal(settings.get('brevo_api_key'), 'xkeysib-secret-value');
  assert.equal(settings.describe().find(row => row.key === 'brevo_api_key').value, '********');
  assert.equal(createSettings(await database(t), {}).describe().find(row => row.key === 'brevo_api_key').value, '', 'an unset secret shows as empty');
  const activity = sqlite.prepare('SELECT actor, kind, subject, detail FROM activity ORDER BY id').all().map(row => ({ ...row }));
  assert.deepEqual(activity, [
    { actor: 'parent@example.com', kind: 'setting', subject: 'brevo_api_key', detail: '{"value":"(hidden)"}' },
    { actor: 'parent@example.com', kind: 'setting', subject: 'guest_passes', detail: '{"value":false}' },
  ]);
  assert.ok(!JSON.stringify(activity).includes('xkeysib'));
});

test('settings reject bad values and survive a corrupt row', async t => {
  const sqlite = await database(t);
  const settings = createSettings(sqlite, {});
  for (const [key, value] of [['family_accent', 'red'], ['kids_public', 'sometimes'], ['site_name', 'x'.repeat(61)],
    ['signup_mode', 'open'], ['site_url', 'https://tube.example.com/watch'], ['notify_email', 'not-an-email'],
    ['views_retention_days', 0], ['family_badge', ['circle']], ['gate_theme', '../evil']]) {
    assert.throws(() => settings.set(key, value), SettingError, key);
  }
  assert.throws(() => settings.set('brand', 'Other'), /Unknown setting/);
  assert.throws(() => settings.get('constructor'), /Unknown setting/);
  assert.throws(() => createSettings(sqlite, { KIDS_PUBLIC: 'maybe' }), /KIDS_PUBLIC/);
  assert.throws(() => createSettings(sqlite, { MAIL_MODE: 'smtp' }), /MAIL_MODE/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM activity').get().n, 0, 'rejected values are not recorded');
  sqlite.prepare("INSERT INTO settings VALUES ('family_accent','\"not a color\"',0)").run();
  const errors = console.error;
  console.error = () => {};
  try { assert.equal(settings.get('family_accent'), DEFAULT_ACCENT); } finally { console.error = errors; }
});
