// Keep publication and its notification outbox in one SQLite transaction.
export function publishClip(sqlite, notifications, clip, uploadJobId) {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite.prepare('UPDATE clips SET position=position+1').run();
    sqlite.prepare(`INSERT INTO clips
      (id,title,src,poster,kind,blurb,published,duration,position,created)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      clip.id, clip.title, clip.src, clip.poster || '', clip.kind || 'video',
      clip.blurb || '', clip.publishedAt, clip.duration, 1, Date.now(),
    );
    if (uploadJobId) {
      sqlite.prepare("UPDATE upload_jobs SET status='done', progress=100, clip_id=?, updated=? WHERE id=?")
        .run(clip.id, Date.now(), uploadJobId);
    }
    notifications.enqueue(clip);
    sqlite.exec('COMMIT');
  } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  notifications.kick();
}
