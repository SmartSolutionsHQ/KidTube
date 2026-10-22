#!/usr/bin/env node
// Builds the public demo's snapshot: "The Demo Family", an invented family with three kids, each with a
// badge drawn by the real badge renderer, a splash theme and an accent; a dozen short clips made here
// with FFmpeg (animated colour, titles and Fluent stickers from the badge catalog, so no real people and
// no footage from anywhere else); likes, reactions, friendly comments from invented relatives, a sealed
// time capsule that opens half an hour after each reset, a daily tape on one kid and "Who watched" rows.
//
//   npm run demo:seed            writes DATA_DIR/demo-snapshot (or DEMO_SNAPSHOT_DIR)
//
// It never touches a live database. A server started with DEMO_MODE=1 restores the snapshot at boot and
// every hour (server/demo.mjs); `npm run demo:reset` applies a fresh one to a running demo right away.
// It refuses to write into a family's install, and replaces an earlier snapshot only if it is one.
// Every row is fixed relative to SEEDED_AT, so the database is the same on every run.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { crc32, deflateSync } from 'node:zlib';
import { installPaths } from '../server/config.mjs';
import { badgeData, renderSpec } from '../server/badge.mjs';
import { textPath } from '../public/js/badge/render.js';
import { migrate, SCHEMA_VERSION } from '../server/schema.mjs';
import {
  DEMO_MARKER, DEMO_ROLES, MARKER_KEY, NO_PASSWORD, SNAPSHOT_DATABASE, SNAPSHOT_FILES, SNAPSHOT_META,
  databaseKind, folderKind, snapshotDir,
} from '../server/demo.mjs';

export const SEEDED_AT = Date.UTC(2026, 9, 1, 16, 0, 0);
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const at = offset => SEEDED_AT + offset;
const iso = offset => new Date(at(offset)).toISOString();

// A UUID-shaped id from a name, so file names and rows never change between runs.
export function mediaId(name) {
  const hex = createHash('sha256').update('demo-media|' + name).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const hex64 = name => createHash('sha256').update('demo|' + name).digest('hex');

// ---------- the family ----------

const PARENT = DEMO_ROLES.parent.email, GRANDMA = DEMO_ROLES.grandma.email, JUNI = DEMO_ROLES.kid.email;
const TEO = 'teo@demo.invalid', BEA = 'bea@demo.invalid', IVY = 'ivy@demo.invalid', OTTO = 'otto@kids.invalid';

const PEOPLE = [
  { email: PARENT, first: 'Sam', last: 'Demo', role: 'super', created: -30 * DAY },
  { email: GRANDMA, first: 'Grandma Rosa', last: '', role: '', created: -29 * DAY },
  { email: TEO, first: 'Uncle Teo', last: '', role: '', created: -28 * DAY },
  { email: BEA, first: 'Auntie Bea', last: '', role: '', created: -20 * DAY },
  { email: JUNI, first: 'Juni', last: '', role: 'kid', channel: 1, budget: 30, created: -30 * DAY },
  { email: OTTO, first: 'Otto', last: '', role: 'kid', channel: 2, created: -30 * DAY },
  // Someone asking to join, so the dashboard's People screen has a request to look at.
  { email: IVY, first: 'Cousin', last: 'Ivy', role: '', status: 'pending', created: -2 * HOUR },
];

const STICKER = (id, x, y, scale = 1, rotate = 0) => ({ id, x, y, scale, rotate });
const EFFECTS = { rgbSplit: false, outline: true, tilt: false, shadow: true };
export const KIDS = [
  { id: 1, slug: 'juni', name: 'Juni', kicker: 'Rockets, robots and really big questions', accent: '#FF5C2B', theme: 'ember-tape',
    badge: { v: 1, shape: 'circle', bg: '#FF5C2B', text: { value: 'JUNI', font: 'anton', color: '#0B0C10' },
      stickers: [STICKER('rocket', 158, 42, 0.9, 20), STICKER('star', 44, 156, 0.7)], effects: EFFECTS } },
  { id: 2, slug: 'otto', name: 'Otto', kicker: 'Level 10 builder', accent: '#4DB8FF', theme: 'arcade-crt',
    badge: { v: 1, shape: 'hexagon', bg: '#4DB8FF', text: { value: 'OTTO', font: 'pixel', color: '#0B0C10' },
      stickers: [STICKER('game', 156, 154, 0.8), STICKER('dino', 44, 46, 0.75, -12)], effects: { ...EFFECTS, rgbSplit: true } } },
  { id: 3, slug: 'mabel', name: 'Mabel', kicker: 'Dance party every day', accent: '#FF6FB5', theme: 'comic-pow',
    badge: { v: 1, shape: 'burst', bg: '#FF6FB5', text: { value: 'MABEL', font: 'bangers', color: '#0B0C10' },
      stickers: [STICKER('rainbow', 156, 46, 0.8), STICKER('bunny', 46, 154, 0.8, 10)], effects: { ...EFFECTS, tilt: true } } },
];
const FAMILY_BADGE = { v: 1, shape: 'tv', bg: '#FFD23F', text: { value: 'DEMO', font: 'anton', color: '#0B0C10' },
  stickers: [STICKER('sparkles', 160, 40, 0.7)], effects: EFFECTS };

// The clips, newest first within each kid. `scene` picks the background, `sticker` what moves over it.
export const CLIPS = [
  { key: 'juni-capsule', kid: 1, title: 'Open me later!', blurb: 'A message for later, sealed by a parent.', scene: 'mandelbrot', sticker: 'gem',
    tone: 0, by: PARENT, published: -1 * HOUR, capsule: { opensIn: 30 * MIN, note: 'Recorded on the first cold morning. Open it when the snow comes!' } },
  { key: 'juni-rocket', kid: 1, title: 'Rocket to the Moon', blurb: 'Three, two, one... blast off!', scene: 'space', sticker: 'rocket', tone: 1, by: JUNI, published: -3 * HOUR },
  { key: 'juni-robot', kid: 1, title: 'The Robot Dance', blurb: 'Beep boop, step step.', scene: 'grid', sticker: 'robot', tone: 2, by: JUNI, published: -26 * HOUR },
  { key: 'juni-whale', kid: 1, title: 'How Big Is a Whale?', blurb: 'Bigger than a bus. Way bigger.', scene: 'ocean', sticker: 'whale', tone: 3, by: PARENT, published: -3 * DAY },
  { key: 'otto-level', kid: 2, title: 'My Best Level Ever', blurb: 'Waiting for a parent to say yes.', scene: 'life', sticker: 'trophy', tone: 4, by: OTTO, published: -40 * MIN, review: 'pending' },
  { key: 'otto-castle', kid: 2, title: 'Pixel Castle Speedrun', blurb: 'New record: 41 seconds.', scene: 'life', sticker: 'crown', tone: 5, by: OTTO, published: -5 * HOUR },
  { key: 'otto-dino', kid: 2, title: 'Dino Day', blurb: 'ROAR. That means hello.', scene: 'jungle', sticker: 'dino', tone: 6, by: OTTO, published: -2 * DAY },
  { key: 'otto-skate', kid: 2, title: 'Skateboard Tricks (Sort Of)', blurb: 'Nobody fell. Mostly.', scene: 'sunset', sticker: 'skateboard', tone: 7, by: PARENT, published: -4 * DAY },
  { key: 'mabel-rainbow', kid: 3, title: 'Rainbow Spin', blurb: 'Spin, spin, spin!', scene: 'rainbow', sticker: 'rainbow', tone: 8, by: PARENT, published: -2 * HOUR },
  { key: 'mabel-pancake', kid: 3, title: 'Pancake Pizza', blurb: 'Breakfast and dinner at the same time.', scene: 'kitchen', sticker: 'pizza', tone: 9, by: PARENT, published: -30 * HOUR },
  { key: 'mabel-bunny', kid: 3, title: 'Bunny Hop', blurb: 'Hop hop hop hop.', scene: 'meadow', sticker: 'bunny', tone: 10, by: PARENT, published: -2 * DAY - 3 * HOUR },
  { key: 'mabel-sunflower', kid: 3, title: 'Sunflower Song', blurb: 'La la la, the sunflower song.', scene: 'garden', sticker: 'sunflower', tone: 11, by: PARENT, published: -5 * DAY },
];
export const CLIP_SECONDS = 8;

const LIKES = [
  ['juni-rocket', GRANDMA], ['juni-rocket', TEO], ['juni-rocket', BEA], ['juni-rocket', PARENT],
  ['juni-robot', GRANDMA], ['juni-robot', PARENT], ['juni-whale', TEO], ['otto-castle', TEO], ['otto-castle', GRANDMA],
  ['otto-castle', JUNI], ['otto-dino', BEA], ['otto-skate', PARENT], ['mabel-rainbow', BEA], ['mabel-rainbow', GRANDMA],
  ['mabel-rainbow', JUNI], ['mabel-pancake', TEO], ['mabel-bunny', GRANDMA], ['mabel-sunflower', BEA],
];
const REACTIONS = [
  ['juni-rocket', GRANDMA, 'wow'], ['juni-rocket', TEO, 'flame'], ['juni-rocket', BEA, 'star'], ['juni-robot', TEO, 'cool'],
  ['juni-robot', GRANDMA, 'party'], ['otto-castle', TEO, 'flame'], ['otto-castle', JUNI, 'wow'], ['otto-dino', BEA, 'wow'],
  ['mabel-rainbow', GRANDMA, 'party'], ['mabel-rainbow', BEA, 'star'], ['mabel-pancake', TEO, 'cool'], ['mabel-bunny', GRANDMA, 'star'],
];
const COMMENTS = [
  ['juni-rocket', GRANDMA, 'Grandma Rosa', 'Juni, that rocket went higher than my kitchen ceiling! So proud of you.', -2 * HOUR],
  ['juni-rocket', TEO, 'Uncle Teo', 'Houston, we have a superstar.', -90 * MIN],
  ['juni-robot', PARENT, 'Sam D.', 'Robot dance at dinner tonight, everyone.', -20 * HOUR],
  ['juni-whale', TEO, 'Uncle Teo', 'Did you know a blue whale\'s heart is as big as a small car?', -2 * DAY],
  ['otto-castle', TEO, 'Uncle Teo', 'Speedrun record! Teach me that jump on Sunday?', -4 * HOUR],
  ['otto-dino', BEA, 'Auntie Bea', 'Roar right back at you! See you at the museum.', -30 * HOUR],
  ['mabel-rainbow', BEA, 'Auntie Bea', 'Mabel, I got dizzy just watching. Love the colours!', -1 * HOUR],
  ['mabel-pancake', JUNI, 'Juni', 'Can we make this for real??', -28 * HOUR],
  ['mabel-bunny', GRANDMA, 'Grandma Rosa', 'Hop hop hop! Grandpa says the bunny looks just like you.', -2 * DAY],
  // Held for a parent to read first, so the dashboard's Comments screen has one waiting.
  ['otto-dino', GRANDMA, 'Grandma Rosa', 'What a big roar for a little dino. Can I come to the next Dino Day?', -50 * MIN, true],
];
// "Who watched": [clip, viewer, started (offset), seconds watched]. Juni's rows today add up to 12 of her
// 30 minutes, so her daily tape has something on it.
const VIEWS = [
  ['juni-rocket', GRANDMA, -110 * MIN, 8], ['juni-robot', GRANDMA, -108 * MIN, 8], ['mabel-rainbow', GRANDMA, -50 * MIN, 8],
  ['juni-rocket', TEO, -95 * MIN, 8], ['otto-castle', TEO, -4 * HOUR, 8], ['juni-whale', TEO, -2 * DAY, 6],
  ['otto-castle', JUNI, -70 * MIN, 240], ['mabel-pancake', JUNI, -60 * MIN, 180], ['juni-robot', JUNI, -45 * MIN, 160],
  ['mabel-bunny', JUNI, -30 * MIN, 140], ['otto-dino', OTTO, -26 * HOUR, 8], ['mabel-sunflower', BEA, -3 * HOUR, 8],
  ['otto-skate', 'guest:' + hex64('guest-token').slice(0, 12), -2 * HOUR, 8],
];

const clipId = key => 'demo-' + key;

// ---------- the database ----------

// Builds the demo's database in `file` (which must not exist). Pure: same input, same rows.
export async function buildDatabase(file, { badges = renderBadges() } = {}) {
  const sqlite = new DatabaseSync(file);
  try {
    await migrate(sqlite);
    sqlite.exec('BEGIN');
    const setting = sqlite.prepare('INSERT OR REPLACE INTO settings (key,value,updated) VALUES (?,?,?)');
    for (const [key, value] of Object.entries({
      site_name: 'The Demo Family', site_tagline: 'Home videos from three invented kids', family_accent: '#FFD23F',
      gate_theme: 'ember-tape', family_badge: badges.family.spec, kids_public: true, signup_mode: 'approval', guest_passes: true,
      comments_default: 'review', review_uploads_default: 'creators', mail_mode: 'disabled', splash_sound: true,
      views_retention_days: 90, activity_retention_days: 365, family_timezone: 'America/New_York', setup_complete: true,
      [MARKER_KEY]: DEMO_MARKER,
    })) setting.run(key, JSON.stringify(value), at(-30 * DAY));

    // Channel 1 comes from the first migration with today's date; REPLACE gives it the seed's.
    const channel = sqlite.prepare(`INSERT OR REPLACE INTO channels (id,slug,name,kicker,tagline,accent,theme_id,badge,logo_rev,review_uploads,position,created)
      VALUES (?,?,?,?,'',?,?,?,1,1,?,?)`);
    for (const kid of KIDS) channel.run(kid.id, kid.slug, kid.name, kid.kicker, kid.accent, kid.theme, JSON.stringify(badges.kids[kid.id].spec), kid.id, at(-30 * DAY));

    const account = sqlite.prepare(`INSERT INTO accounts (email,first,last,salt,hash,status,role,created,channel_id,watch_budget_minutes)
      VALUES (?,?,?,'',?,?,?,?,?,?)`);
    for (const person of PEOPLE) {
      account.run(person.email, person.first, person.last, NO_PASSWORD, person.status || 'approved', person.role, at(person.created),
        person.channel ?? null, person.budget || 0);
    }
    // As family.mjs does: a .invalid address is never sent new-video emails.
    for (const person of PEOPLE) sqlite.prepare('INSERT INTO video_email_preferences (email,unsubscribed) VALUES (?,1)').run(person.email);

    const clip = sqlite.prepare(`INSERT INTO clips (id,title,src,poster,kind,blurb,published,duration,position,created,hidden,channel_id,review,
      opens_at,opened_at,sealed_by,capsule_note) VALUES (?,?,?,?,'video',?,?,?,?,?,0,?,?,?,0,?,?)`);
    const job = sqlite.prepare(`INSERT INTO upload_jobs (id,email,title,size,status,progress,clip_id,error,created,updated,channel_id,opens_at,capsule_note)
      VALUES (?,?,?,?,'done',100,?,NULL,?,?,?,?,?)`);
    const positions = new Map();
    for (const c of CLIPS) {
      const media = mediaId(c.key);
      const position = (positions.get(c.kid) || 0) + 1;
      positions.set(c.kid, position);
      const opensAt = c.capsule ? at(c.capsule.opensIn) : 0;
      clip.run(clipId(c.key), c.title, `/api/video/${media}`, `/api/video/${media}/poster`, c.blurb, iso(c.published), CLIP_SECONDS,
        position, at(c.published), c.kid, c.review || 'approved', opensAt, c.capsule ? c.by : '', c.capsule?.note || '');
      job.run(media, c.by, c.title, 1, clipId(c.key), at(c.published - 2 * MIN), at(c.published), c.kid, opensAt, c.capsule?.note || '');
    }

    const like = sqlite.prepare('INSERT INTO likes (clip_id,email,created) VALUES (?,?,?)');
    LIKES.forEach(([key, email], i) => like.run(clipId(key), email, at(-(i + 1) * 17 * MIN)));
    const reaction = sqlite.prepare('INSERT INTO reactions (clip_id,email,kind,created) VALUES (?,?,?,?)');
    REACTIONS.forEach(([key, email, kind], i) => reaction.run(clipId(key), email, kind, at(-(i + 1) * 13 * MIN)));
    const comment = sqlite.prepare('INSERT INTO comments (id,clip_id,email,name,body,created,hidden) VALUES (?,?,?,?,?,?,?)');
    COMMENTS.forEach(([key, email, name, body, when, held], i) => comment.run(`demo-comment-${i + 1}`, clipId(key), email, name, body, at(when), held ? 1 : 0));
    const view = sqlite.prepare('INSERT INTO views (clip_id,channel_id,viewer,started,updated,seconds,completed) VALUES (?,?,?,?,?,?,?)');
    for (const [key, viewer, when, seconds] of [...VIEWS].sort((a, b) => a[2] - b[2])) {
      const kid = CLIPS.find(c => c.key === key).kid;
      view.run(clipId(key), kid, viewer, at(when), at(when) + seconds * 1000, seconds, seconds >= CLIP_SECONDS ? 1 : 0);
    }

    // A guest pass a parent made for the babysitter, already used. Its hash can never match a real code.
    const guestCode = hex64('guest-code'), guestToken = hex64('guest-token');
    sqlite.prepare(`INSERT INTO guest_codes (code_hash,creator,created,expires,redeemed,token_hash,session_expires,channel_id)
      VALUES (?,?,?,?,?,?,?,NULL)`).run(guestCode, PARENT, at(-3 * HOUR), at(21 * HOUR), at(-150 * MIN), guestToken, at(22 * HOUR));

    const activity = sqlite.prepare('INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (?,?,?,?,?)');
    const log = (when, actor, kind, subject, detail = {}) => activity.run(at(when), actor, kind, String(subject), JSON.stringify(detail));
    for (const kid of KIDS) log(-30 * DAY + kid.id * MIN, PARENT, 'channel', kid.id, { action: 'create', slug: kid.slug, name: kid.name, login: kid.id < 3 ? kid.slug : null });
    log(-29 * DAY, PARENT, 'people', GRANDMA, { action: 'approved' });
    log(-20 * DAY, PARENT, 'budget.set', JUNI, { minutes: 30 });
    log(-4 * HOUR, PARENT, 'review', clipId('otto-castle'), { decision: 'approved', from: 'pending', channel: 'otto' });
    log(-3 * HOUR, PARENT, 'guest', guestCode.slice(0, 12), { action: 'create', note: 'the babysitter', channel: '' });
    log(-1 * HOUR, PARENT, 'capsule.seal', clipId('juni-capsule'), { opensAt: at(30 * MIN) });
    // When each person was last here, for the People screen.
    for (const [email, when] of [[GRANDMA, -48 * MIN], [TEO, -88 * MIN], [BEA, -55 * MIN], [JUNI, -28 * MIN], [OTTO, -25 * HOUR]]) log(when, email, 'seen', email);
    sqlite.exec('COMMIT');
  } finally { sqlite.close(); }
}

// ---------- badges, with the server's own renderer ----------

const contentHash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

export function renderBadges() {
  const one = input => {
    const { spec, svg } = renderSpec(input);
    return { spec, svg, name: `badge-${contentHash(svg)}.svg` };
  };
  return { family: one(FAMILY_BADGE), kids: Object.fromEntries(KIDS.map(kid => [kid.id, one(kid.badge)])) };
}

// The files brandfiles.mjs serves, laid out as it writes them: DATA_DIR/brand/<folder>/{index.json,badge-*.svg}.
function badgeFiles(badges) {
  const files = {};
  const folder = (dir, badge) => {
    files[`brand/${dir}/${badge.name}`] = Buffer.from(badge.svg);
    files[`brand/${dir}/index.json`] = Buffer.from(JSON.stringify({ badge: badge.name }));
  };
  folder('family', badges.family);
  for (const kid of KIDS) folder(`channels/${kid.id}`, badges.kids[kid.id]);
  return files;
}

// ---------- drawing: SVG paths to RGBA pixels ----------

// Flattens an SVG path (absolute and relative M L H V C S Q T A Z) into closed polygons, through `map`.
function flatten(d, map) {
  const polys = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0, poly = null;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const number = () => {
    skip();
    const match = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(d.slice(i));
    if (!match) throw new Error(`Bad path near "${d.slice(i, i + 12)}"`);
    i += match[0].length;
    return Number(match[0]);
  };
  const flag = () => { skip(); return d[i++] === '1'; };
  const add = (px, py) => { poly.push(map(px, py)); };
  // Enough steps that each is about 3 pixels long, judged by the control polygon.
  const curve = (points, fn) => {
    let length = 0;
    for (let k = 1; k < points.length; k++) {
      const p = map(...points[k - 1]), q = map(...points[k]);
      length += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    const steps = Math.max(4, Math.min(64, Math.ceil(length / 3)));
    for (let k = 1; k <= steps; k++) add(...fn(k / steps));
  };
  const close = () => { if (poly && poly.length > 2) polys.push(poly); poly = null; };
  while (i < d.length) {
    skip();
    if (i >= d.length) break;
    if (/[a-z]/i.test(d[i])) cmd = d[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { close(); x = sx; y = sy; cmd = rel ? 'm' : 'M'; poly = null; continue; }
    if (C === 'M') {
      close();
      x = ox + number(); y = oy + number(); sx = x; sy = y;
      poly = [map(x, y)];
      cmd = rel ? 'l' : 'L';
      cx = x; cy = y;
      continue;
    }
    if (!poly) poly = [map(x, y)];
    if (C === 'L') { x = ox + number(); y = oy + number(); add(x, y); cx = x; cy = y; }
    else if (C === 'H') { x = ox + number(); add(x, y); cx = x; cy = y; }
    else if (C === 'V') { y = oy + number(); add(x, y); cx = x; cy = y; }
    else if (C === 'C' || C === 'S') {
      let x1, y1;
      if (C === 'C') { x1 = ox + number(); y1 = oy + number(); } else { x1 = 2 * x - cx; y1 = 2 * y - cy; }
      const x2 = ox + number(), y2 = oy + number(), ex = ox + number(), ey = oy + number();
      const x0 = x, y0 = y;
      curve([[x0, y0], [x1, y1], [x2, y2], [ex, ey]], t => {
        const u = 1 - t;
        return [u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey];
      });
      cx = x2; cy = y2; x = ex; y = ey;
    } else if (C === 'Q' || C === 'T') {
      let x1, y1;
      if (C === 'Q') { x1 = ox + number(); y1 = oy + number(); } else { x1 = 2 * x - cx; y1 = 2 * y - cy; }
      const ex = ox + number(), ey = oy + number(), x0 = x, y0 = y;
      curve([[x0, y0], [x1, y1], [ex, ey]], t => {
        const u = 1 - t;
        return [u * u * x0 + 2 * u * t * x1 + t * t * ex, u * u * y0 + 2 * u * t * y1 + t * t * ey];
      });
      cx = x1; cy = y1; x = ex; y = ey;
    } else if (C === 'A') {
      let rx = Math.abs(number()), ry = Math.abs(number());
      const phi = number() * Math.PI / 180, large = flag(), sweep = flag();
      const ex = ox + number(), ey = oy + number();
      arc(x, y, rx, ry, phi, large, sweep, ex, ey).forEach(point => add(...point));
      x = ex; y = ey; cx = x; cy = y;
    } else throw new Error(`Unsupported path command ${cmd}`);
  }
  close();
  return polys;
}

// SVG's endpoint arc as points (SVG 1.1 appendix F.6.5).
function arc(x1, y1, rx, ry, phi, large, sweep, x2, y2) {
  if (!rx || !ry) return [[x2, y2]];
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const k = sign * Math.sqrt(Math.max(0, num / (rx * rx * yp * yp + ry * ry * xp * xp)));
  const cxp = k * (rx * yp) / ry, cyp = -k * (ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let delta = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const steps = Math.max(6, Math.ceil(Math.abs(delta) / (Math.PI / 24)));
  const points = [];
  for (let s = 1; s <= steps; s++) {
    const t = start + delta * s / steps;
    points.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return points;
}

class Canvas {
  constructor(width, height) { this.width = width; this.height = height; this.pixels = new Float32Array(width * height * 4); }

  // Fills polygons with a colour: 4 sub-scanlines a pixel, exact coverage along each one.
  fill(polys, hex, { opacity = 1, rule = 'nonzero' } = {}) {
    const { width, height } = this, SUB = 4;
    const color = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255);
    const edges = [];
    for (const poly of polys) {
      for (let k = 0; k < poly.length; k++) {
        const [ax, ay] = poly[k], [bx, by] = poly[(k + 1) % poly.length];
        if (ay !== by) edges.push(ay < by ? [ax, ay, bx, by, 1] : [bx, by, ax, ay, -1]);
      }
    }
    if (!edges.length) return;
    const top = Math.max(0, Math.floor(Math.min(...edges.map(e => e[1])))), bottom = Math.min(height, Math.ceil(Math.max(...edges.map(e => e[3]))));
    const cover = new Float32Array(width + 1);
    for (let py = top; py < bottom; py++) {
      cover.fill(0);
      let any = false;
      for (let s = 0; s < SUB; s++) {
        const sy = py + (s + 0.5) / SUB;
        const hits = [];
        for (const [x0, y0, x1, y1, dir] of edges) if (sy >= y0 && sy < y1) hits.push([x0 + (sy - y0) / (y1 - y0) * (x1 - x0), dir]);
        if (!hits.length) continue;
        hits.sort((a, b) => a[0] - b[0]);
        let winding = 0;
        for (let h = 0; h < hits.length - 1; h++) {
          winding += hits[h][1];
          const inside = rule === 'evenodd' ? Math.abs(winding) % 2 === 1 : winding !== 0;
          if (!inside) continue;
          const a = Math.max(0, hits[h][0]), b = Math.min(width, hits[h + 1][0]);
          if (b <= a) continue;
          any = true;
          const ia = Math.floor(a), ib = Math.floor(b);
          if (ia === ib) { cover[ia] += (b - a) / SUB; continue; }
          cover[ia] += (ia + 1 - a) / SUB;
          for (let px = ia + 1; px < ib; px++) cover[px] += 1 / SUB;
          if (ib < width) cover[ib] += (b - ib) / SUB;
        }
      }
      if (!any) continue;
      for (let px = 0; px < width; px++) {
        const alpha = Math.min(1, cover[px]) * opacity;
        if (alpha <= 0) continue;
        const o = (py * width + px) * 4, da = this.pixels[o + 3], outA = alpha + da * (1 - alpha);
        for (let c = 0; c < 3; c++) this.pixels[o + c] = (color[c] * alpha + this.pixels[o + c] * da * (1 - alpha)) / outA;
        this.pixels[o + 3] = outA;
      }
    }
  }

  png() {
    const { width, height } = this;
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width * 4; x++) raw[y * (width * 4 + 1) + 1 + x] = Math.round(Math.min(1, Math.max(0, this.pixels[y * width * 4 + x])) * 255);
    }
    const chunk = (type, data) => {
      const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type), data]);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
      return Buffer.concat([length, body, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  }
}

// A sticker from the badge catalog, `size` pixels square.
function drawSticker(id, size) {
  const sticker = badgeData().stickers[id];
  if (!sticker) throw new Error(`No sticker ${id}`);
  const [vx, vy, vw, vh] = sticker.viewBox.split(/\s+/).map(Number);
  const canvas = new Canvas(size, size), k = size / Math.max(vw, vh);
  const map = (px, py) => [(px - vx) * k, (py - vy) * k];
  for (const path of sticker.paths) canvas.fill(flatten(path.d, map), path.fill || '#000000', { rule: path.rule || 'nonzero', opacity: path.opacity ?? 1 });
  return canvas;
}

// Text in a glyph table, chalk with an ink outline and a soft shadow, centred on (cx, baseline).
function drawText(canvas, value, { font = 'anton', height, cx, baseline, color = '#F7F4EC', outline = '#0B0C10', maxWidth }) {
  const table = badgeData().glyphs[font];
  const { d, width } = textPath(value, table);
  let k = height / (table.capHeight || table.ascender * 0.72);
  if (maxWidth && width * k > maxWidth) k = maxWidth / width;
  const left = cx - (width * k) / 2;
  const at = (dx, dy) => (px, py) => [left + px * k + dx, baseline - py * k + dy];
  const ring = Math.max(2, height / 14);
  canvas.fill(flatten(d, at(ring * 0.6, ring * 1.4)), '#000000', { opacity: 0.35 });
  for (let a = 0; a < 16; a++) canvas.fill(flatten(d, at(Math.cos(a * Math.PI / 8) * ring, Math.sin(a * Math.PI / 8) * ring)), outline);
  canvas.fill(flatten(d, at(0, 0)), color);
  return width * k;
}

function wrap(words, font, height, maxWidth) {
  const table = badgeData().glyphs[font];
  const k = height / (table.capHeight || table.ascender * 0.72);
  const lines = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last && textPath(`${last} ${word}`, table).width * k <= maxWidth) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

// ---------- the clips ----------

const W = 540, H = 960, FPS = 30;
// Calm, slow, never flashing: colour that drifts, shapes that float. Each is an FFmpeg lavfi source.
const SCENES = {
  space: `gradients=s=${W}x${H}:c0=0x0B0C2A:c1=0x2B1A6B:c2=0x0B3D6B:n=3:type=radial:speed=0.008:seed=11:r=${FPS}`,
  mandelbrot: `mandelbrot=s=${W}x${H}:r=${FPS}:maxiter=300:start_scale=2.6:end_scale=1.4:end_pts=${CLIP_SECONDS * FPS}:start_x=-0.743643887:start_y=0.131825904:outer=normalized_iteration_count,hue=s=0.9`,
  grid: `gradients=s=${W}x${H}:c0=0x1D0F3B:c1=0xFF5C2B:c2=0x3B1D6B:n=3:type=linear:speed=0.01:seed=4:r=${FPS},drawgrid=w=60:h=60:t=2:c=white@0.12`,
  ocean: `gradients=s=${W}x${H}:c0=0x062A4D:c1=0x0E6BA8:c2=0x4DB8FF:n=3:type=linear:x0=0:y0=0:x1=0:y1=${H}:speed=0.006:seed=2:r=${FPS}`,
  life: `life=s=54x96:r=2:ratio=0.18:seed=7:mold=40:life_color=0x4DB8FF:death_color=0x0B0C2A:mold_color=0x16305A,scale=${W}:${H}:flags=neighbor,fps=${FPS},tmix=frames=12`,
  jungle: `gradients=s=${W}x${H}:c0=0x0F3D1F:c1=0x3DFFB0:c2=0x1F6B2F:n=3:type=circular:speed=0.008:seed=9:r=${FPS}`,
  sunset: `gradients=s=${W}x${H}:c0=0xFFD23F:c1=0xFF5C2B:c2=0x6A1B6B:n=3:type=linear:x0=0:y0=0:x1=0:y1=${H}:speed=0.006:seed=5:r=${FPS}`,
  rainbow: `gradients=s=${W}x${H}:c0=0xFF6FB5:c1=0xFFD23F:c2=0x3DFFB0:c3=0x4DB8FF:c4=0xA98BFF:n=5:type=spiral:speed=0.01:seed=3:r=${FPS}`,
  kitchen: `gradients=s=${W}x${H}:c0=0xFFD23F:c1=0xFF9F43:c2=0xFFF3D6:n=3:type=square:speed=0.008:seed=6:r=${FPS},drawgrid=w=90:h=90:t=3:c=white@0.25`,
  meadow: `gradients=s=${W}x${H}:c0=0x9BE15D:c1=0x3DFFB0:c2=0xC6FF3D:n=3:type=radial:speed=0.008:seed=8:r=${FPS}`,
  garden: `gradients=s=${W}x${H}:c0=0xFFD23F:c1=0x9BE15D:c2=0x4DB8FF:n=3:type=linear:speed=0.008:seed=10:r=${FPS}`,
};
// How each sticker moves: x and y as FFmpeg overlay expressions over t (seconds) and w, h (its size).
const MOVES = [
  `x=(W-w)/2+120*sin(2*PI*t/${CLIP_SECONDS}):y=H*0.62-h/2-60*sin(2*PI*t/4)`,
  `x=-w+(W+w)*t/${CLIP_SECONDS}:y=H*0.58-h/2+30*sin(2*PI*t/2)`,
  `x=(W-w)/2+40*sin(2*PI*t/2):y=H*0.6-h/2-80*abs(sin(PI*t/1.4))`,
];
// A music box: eight soft notes from a pentatonic scale, a different tune for each clip.
const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];
function tune(seed) {
  const pick = n => NOTES[(seed * 5 + n * (seed % 3 + 2) + (n % 3)) % NOTES.length];
  let freq = String(pick(7));
  for (let n = 6; n >= 0; n--) freq = `if(lt(mod(t\\,4)\\,${(n + 1) / 2})\\,${pick(n)}\\,${freq})`;
  return `aevalsrc=0.07*sin(2*PI*(${freq})*t)*exp(-3*mod(t\\,0.5))+0.02*sin(4*PI*(${freq})*t)*exp(-5*mod(t\\,0.5)):s=44100:d=${CLIP_SECONDS}`;
}

// Small, fixed decorations drawn under the title: stars for space, bubbles for the sea.
const DECOR = { space: { color: '#F7F4EC', count: 70, size: [1, 3], opacity: 0.8 }, ocean: { color: '#CFF4FF', count: 26, size: [4, 14], opacity: 0.35 } };
function decorate(canvas, scene, seed) {
  const decor = DECOR[scene];
  if (!decor) return;
  let state = seed;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
  for (let n = 0; n < decor.count; n++) {
    const x = random() * W, y = 300 + random() * (H - 380), r = decor.size[0] + random() * (decor.size[1] - decor.size[0]);
    const ring = Array.from({ length: 16 }, (_, k) => [x + r * Math.cos(k * Math.PI / 8), y + r * Math.sin(k * Math.PI / 8)]);
    canvas.fill([ring], decor.color, { opacity: decor.opacity * (0.5 + random() / 2) });
  }
}

function titleCard(c) {
  const canvas = new Canvas(W, H);
  const kid = KIDS.find(k => k.id === c.kid);
  decorate(canvas, c.scene, c.tone + 1);
  const tapes = CLIPS.filter(x => x.kid === c.kid);
  const words = c.title.toUpperCase().split(' ');
  const lines = wrap(words, 'anton', 74, W - 80);
  drawText(canvas, `${kid.name.toUpperCase()} - TAPE ${String(tapes.length - tapes.indexOf(c)).padStart(2, '0')}`,
    { font: 'pixel', height: 26, cx: W / 2, baseline: 132, maxWidth: W - 80 });
  lines.forEach((line, i) => drawText(canvas, line, { font: 'anton', height: 74, cx: W / 2, baseline: 236 + i * 96, maxWidth: W - 60 }));
  return canvas.png();
}

function ffmpegPath() {
  const command = process.env.FFMPEG_PATH || 'ffmpeg';
  const probe = spawnSync(command, ['-hide_banner', '-version'], { encoding: 'utf8' });
  if (probe.status !== 0) throw new Error(`FFmpeg is needed to make the demo clips (tried "${command}"). Install it, or set FFMPEG_PATH.`);
  return command;
}

// Renders one clip and its poster into `out`; returns their relative paths.
function renderClip(ffmpeg, c, index, work, out) {
  const media = mediaId(c.key);
  const sticker = join(work, `${c.key}-sticker.png`), title = join(work, `${c.key}-title.png`);
  writeFileSync(sticker, drawSticker(c.sticker, 250).png());
  writeFileSync(title, titleCard(c));
  const video = join(out, 'videos', `${media}.mp4`), poster = join(out, 'videos', `${media}.jpg`);
  mkdirSync(dirname(video), { recursive: true });
  const run = args => execFileSync(ffmpeg, ['-nostdin', '-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  run([
    '-f', 'lavfi', '-t', String(CLIP_SECONDS), '-i', SCENES[c.scene],
    '-loop', '1', '-framerate', String(FPS), '-t', String(CLIP_SECONDS), '-i', sticker,
    '-loop', '1', '-framerate', String(FPS), '-t', String(CLIP_SECONDS), '-i', title,
    '-f', 'lavfi', '-i', tune(c.tone),
    '-filter_complex', [
      `[0:v]scale=${W}:${H},setsar=1,format=yuv420p[bg]`,
      `[1:v]format=rgba[st]`,
      `[bg][st]overlay=${MOVES[index % MOVES.length]}:eval=frame:shortest=1[a]`,
      `[2:v]format=rgba,fade=in:st=0.2:d=0.8:alpha=1[ti]`,
      `[a][ti]overlay=0:0:shortest=1,fade=out:st=${CLIP_SECONDS - 0.6}:d=0.6,format=yuv420p[v]`,
      `[3:a]afade=in:d=0.3,afade=out:st=${CLIP_SECONDS - 0.6}:d=0.6[au]`,
    ].join(';'),
    '-map', '[v]', '-map', '[au]', '-t', String(CLIP_SECONDS), '-map_metadata', '-1',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '64k', '-ar', '44100', '-movflags', '+faststart', '-f', 'mp4', video,
  ]);
  run(['-ss', '2', '-i', video, '-frames:v', '1', '-vf', `scale=480:-2`, '-q:v', '4', '-map_metadata', '-1', '-f', 'image2', '-c:v', 'mjpeg', poster]);
  return [`videos/${media}.mp4`, `videos/${media}.jpg`];
}

// ---------- the snapshot ----------

function refuseFamily(dataDir, database) {
  if (existsSync(database)) {
    const sqlite = new DatabaseSync(database, { readOnly: true });
    try { if (databaseKind(sqlite) === 'family') throw new Error(`${database} is a family's database. Seed the demo in a folder of its own (set DATA_DIR and DATABASE_PATH).`); }
    finally { sqlite.close(); }
  }
  if (folderKind(dataDir) === 'family') throw new Error(`${dataDir} holds a family's videos. Seed the demo in a folder of its own (set DATA_DIR and DATABASE_PATH).`);
}

// Writes the snapshot next to `target`, then swaps it in; an older snapshot is replaced only if it is one.
export async function writeSnapshot(target, { render = true, log = () => {} } = {}) {
  if (existsSync(target)) {
    let meta = null;
    try { meta = JSON.parse(readFileSync(join(target, SNAPSHOT_META), 'utf8')); } catch {}
    if (meta?.marker !== DEMO_MARKER) throw new Error(`${target} exists and is not a demo snapshot, so it is left alone. Pick another DEMO_SNAPSHOT_DIR.`);
  }
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(`${target}.new-`);
  try {
    const out = join(staging, SNAPSHOT_FILES);
    const badges = renderBadges();
    const files = {};
    for (const [rel, bytes] of Object.entries(badgeFiles(badges))) {
      mkdirSync(dirname(join(out, rel)), { recursive: true });
      writeFileSync(join(out, rel), bytes);
      files[rel] = bytes;
    }
    if (render) {
      const ffmpeg = ffmpegPath();
      const work = join(staging, 'work');
      mkdirSync(work);
      for (const [index, c] of CLIPS.entries()) {
        log(`  ${String(index + 1).padStart(2)} / ${CLIPS.length}  ${c.title}`);
        for (const rel of renderClip(ffmpeg, c, index, work, out)) files[rel] = readFileSync(join(out, rel));
      }
      rmSync(work, { recursive: true, force: true });
    }
    await buildDatabase(join(staging, SNAPSHOT_DATABASE), { badges });
    const meta = {
      marker: DEMO_MARKER, seededAt: SEEDED_AT, schema: SCHEMA_VERSION, made: new Date().toISOString(),
      files: Object.fromEntries(Object.entries(files).sort().map(([rel, bytes]) => [rel, createHash('sha256').update(bytes).digest('hex')])),
    };
    writeFileSync(join(staging, SNAPSHOT_META), JSON.stringify(meta, null, 2) + '\n');
    const old = existsSync(target) ? `${target}.old-${process.pid}` : null;
    if (old) renameSync(target, old);
    renameSync(staging, target);
    if (old) rmSync(old, { recursive: true, force: true });
    return meta;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const paths = installPaths();
  const target = snapshotDir(paths.dataDir);
  refuseFamily(paths.dataDir, paths.database);
  console.log(`Making the demo family's clips with FFmpeg (${CLIPS.length} clips, about a minute)...`);
  const meta = await writeSnapshot(target, { log: line => console.log(line) });
  console.log(`Demo snapshot written to ${target} (${Object.keys(meta.files).length} files).`);
  console.log('Start the server with DEMO_MODE=1 to serve it. A demo that is already running picks it up with "npm run demo:reset".');
}

if (import.meta.main) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}
