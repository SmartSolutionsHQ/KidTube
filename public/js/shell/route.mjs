// The viewer's address bar. Pure, so Node tests import it as is.
//
//   #/c/<slug>            a kid's channel
//   #/c/<slug>/v/<id>     one clip on that channel
//   #/v/<id>              an old link from before channels; the shell asks /api/clips/locate where it lives
//   anything else         the front door

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const CLIP = /^[A-Za-z0-9_-]{1,80}$/;

// feed.js reads the clip out of the hash with this, whichever form the link takes.
export const DEEP_LINK = /^#\/(?:c\/[^/]+\/)?v\/(.+)$/;

const decode = part => { try { return decodeURIComponent(part); } catch { return ''; } };

export function parseRoute(hash = '') {
  const parts = String(hash).replace(/^#\/?/, '').split('/').filter(Boolean).map(decode);
  if (parts[0] === 'c' && SLUG.test(parts[1] || '')) {
    if (parts.length === 2) return { name: 'channel', slug: parts[1] };
    if (parts.length === 4 && parts[2] === 'v' && CLIP.test(parts[3])) return { name: 'clip', slug: parts[1], id: parts[3] };
    return { name: 'channel', slug: parts[1] };
  }
  if (parts[0] === 'v' && parts.length === 2 && CLIP.test(parts[1])) return { name: 'legacy', id: parts[1] };
  return { name: 'home' };
}

export function channelHash(slug, id) {
  if (!SLUG.test(String(slug || ''))) return id && CLIP.test(id) ? `#/v/${id}` : '#/';
  return `#/c/${slug}` + (id && CLIP.test(id) ? `/v/${id}` : '');
}

// The clip a route points at, for both the channel and the old form.
export const routeClip = route => (route.name === 'clip' || route.name === 'legacy' ? route.id : null);
