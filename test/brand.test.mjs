import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BRAND_NAME } from '../server/brand.mjs';
import { createVideoNotifications, videoEmail } from '../server/notifications.mjs';
import { migrate } from '../server/schema.mjs';
import { ROOT } from './helpers.mjs';

// The product will be renamed before launch; only server/brand.mjs may spell its name. Pages use the
// {{brand.*}} tokens static.mjs fills in, and scripts read the name from /api/site.
const TEXT = /\.(?:m?js|css|html|json|svg|txt|md|webmanifest)$/;
for (const folder of ['server', 'public']) {
  test(`${folder}/ names the product only through server/brand.mjs`, () => {
    const hits = [];
    for (const name of readdirSync(join(ROOT, folder), { recursive: true })) {
      if ((folder === 'server' && name === 'brand.mjs') || !TEXT.test(name)) continue;
      readFileSync(join(ROOT, folder, name), 'utf8').split('\n').forEach((line, index) => {
        if (/KidTube|KIDTUBE/.test(line)) hits.push(`${folder}/${name}:${index + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    assert.deepEqual(hits, []);
  });
}

test('server copy takes the brand name from the brand module', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  await migrate(sqlite);
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
