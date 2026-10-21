import { DEFAULT_CHANNEL_ID, channelById } from './channels.mjs';

// Keep publication and its notification outbox in one SQLite transaction.
export function publishClip(sqlite, notifications, clip, uploadJobId) {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const review = clip.review || 'approved';
    // Link columns have no foreign keys (see schema v2), so check the channel here.
    const channelId = clip.channelId ?? DEFAULT_CHANNEL_ID;
    if (!channelById(sqlite, channelId)) throw new Error(`Channel ${channelId} does not exist`);
    sqlite.prepare('UPDATE clips SET position=position+1').run();
    sqlite.prepare(`INSERT INTO clips
      (id,title,src,poster,kind,blurb,published,duration,position,created,channel_id,review)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      clip.id, clip.title, clip.src, clip.poster || '', clip.kind || 'video',
      clip.blurb || '', clip.publishedAt, clip.duration, 1, Date.now(),
      channelId, review,
    );
    if (uploadJobId) {
      sqlite.prepare("UPDATE upload_jobs SET status='done', progress=100, clip_id=?, updated=? WHERE id=?")
        .run(clip.id, Date.now(), uploadJobId);
    }
    // A clip waiting for review is announced when a parent approves it.
    if (review === 'approved') notifications.enqueue({ ...clip, channelId });
    sqlite.exec('COMMIT');
  } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  notifications.kick();
}
