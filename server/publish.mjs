import { DEFAULT_CHANNEL_ID, channelById } from './channels.mjs';
import { openCapsule } from './capsules.mjs';

// Keep publication and its notification outbox in one SQLite transaction.
export function publishClip(sqlite, notifications, clip, uploadJobId) {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const review = clip.review || 'approved';
    // Link columns have no foreign keys (see schema v2), so check the channel here.
    const channelId = clip.channelId ?? DEFAULT_CHANNEL_ID;
    if (!channelById(sqlite, channelId)) throw new Error(`Channel ${channelId} does not exist`);
    // New clips lead their own channel's reel.
    sqlite.prepare('UPDATE clips SET position=position+1 WHERE channel_id=?').run(channelId);
    // A time capsule (opensAt in the future) is published sealed; validateSeal checked it at upload start.
    const opensAt = Number(clip.opensAt) || 0;
    const sealed = opensAt > Date.now();
    sqlite.prepare(`INSERT INTO clips
      (id,title,src,poster,kind,blurb,published,duration,position,created,channel_id,review,opens_at,sealed_by,capsule_note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      clip.id, clip.title, clip.src, clip.poster || '', clip.kind || 'video',
      clip.blurb || '', clip.publishedAt, clip.duration, 1, Date.now(),
      channelId, review, sealed ? opensAt : 0, sealed ? clip.sealedBy || '' : '', sealed ? clip.capsuleNote || '' : '',
    );
    if (sealed) {
      sqlite.prepare("INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (?,?,'capsule.seal',?,?)")
        .run(Date.now(), clip.sealedBy || 'system', clip.id, JSON.stringify({ opensAt }));
    }
    if (uploadJobId) {
      sqlite.prepare("UPDATE upload_jobs SET status='done', progress=100, clip_id=?, updated=? WHERE id=?")
        .run(clip.id, Date.now(), uploadJobId);
    }
    // A clip waiting for review is announced when a parent approves it, a capsule when it opens.
    if (review === 'approved' && !sealed) notifications.enqueue({ ...clip, channelId });
    sqlite.exec('COMMIT');
  } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  notifications.kick();
}

const logReview = (sqlite, actor, clipId, detail) => sqlite.prepare(
  "INSERT INTO activity (ts,actor,kind,subject,detail) VALUES (?,?,'review',?,?)").run(Date.now(), actor, clipId, JSON.stringify(detail));

// A parent says yes to a clip waiting for review: it goes live at the top of its channel and the
// new-video email goes out, linking to #/c/<slug>/v/<id>. The dashboard (M7) calls this; so does
// POST /api/admin/clips/review. Returns the clip's channel slug, or null when nothing was waiting.
export function approveClip(sqlite, notifications, clipId, actor = 'system') {
  let channel = null;
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const clip = sqlite.prepare(`SELECT c.*, ch.slug FROM clips c LEFT JOIN channels ch ON ch.id=c.channel_id
      WHERE c.id=? AND c.review<>'approved'`).get(clipId);
    if (clip) {
      const now = Date.now();
      sqlite.prepare('UPDATE clips SET position=position+1 WHERE channel_id=? AND id<>?').run(clip.channel_id, clip.id);
      sqlite.prepare("UPDATE clips SET review='approved', position=1 WHERE id=?").run(clip.id);
      // A capsule is announced when it opens: now, if its date passed while it waited, else on its date.
      const capsule = clip.opens_at > 0 && !clip.opened_at;
      if (capsule && clip.opens_at <= now) openCapsule(sqlite, notifications, clip, now, actor);
      else if (!clip.hidden && !capsule) {
        notifications.enqueue({ id: clip.id, title: clip.title, blurb: clip.blurb, duration: clip.duration,
          kind: clip.kind, publishedAt: clip.published, channelId: clip.channel_id });
      }
      logReview(sqlite, actor, clip.id, { decision: 'approved', from: clip.review, channel: clip.slug || '' });
      channel = clip.slug || '';
    }
    sqlite.exec('COMMIT');
  } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  if (channel !== null) notifications.kick();
  return channel;
}

// A parent says no: the clip stays out of the feed, playable only by parents and the kid who posted it.
export function rejectClip(sqlite, clipId, actor = 'system') {
  const clip = sqlite.prepare("SELECT id, review FROM clips WHERE id=? AND review='pending'").get(clipId);
  if (!clip) return false;
  sqlite.prepare("UPDATE clips SET review='rejected' WHERE id=?").run(clipId);
  logReview(sqlite, actor, clipId, { decision: 'rejected', from: clip.review });
  return true;
}
