// Pure helpers for the setup wizard: no DOM, no fetch, so the tests import them in Node.

export const STEP_NAMES = [
  'Setup code', 'Your parent account', 'Family name and web address', 'Add your kids',
  'Who can watch', 'Email, if you want it', 'Put it on your phone',
];

// Types the dashes as the parent goes: "kt7qmx" → "KT-7QMX". Look-alike letters are left for the server,
// which folds O into 0 and I or L into 1.
export function formatCode(input) {
  const raw = String(input || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^KT/, '').slice(0, 20);
  const groups = raw.match(/.{1,5}/g) || [];
  return raw ? ['KT', ...groups].join('-') : '';
}

export const codeComplete = value => /^KT(?:-[0-9A-Z]{5}){4}$/.test(formatCode(value));

const SMALL_WORDS = new Set(['the', 'a', 'an', 'and', 'of', 'tapes', 'tube', 'tv', 'channel', 'family', 'videos', 'video']);

// "The Okafor Tapes" → "O", "Rivera Family Videos" → "R", "Mia and Leo" → "ML". Up to three letters.
export function initials(name) {
  const words = String(name || '').normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const kept = words.filter(word => !SMALL_WORDS.has(word.toLowerCase()));
  const letters = (kept.length ? kept : words).slice(0, 3).map(word => [...word][0]);
  return letters.join('').toUpperCase();
}

// Badge text keeps Latin-1 printable characters only (the badge fonts have nothing else), up to 10.
export function badgeText(value, max = 10) {
  let out = '';
  for (const char of String(value || '').toUpperCase()) {
    const code = char.codePointAt(0);
    if (char.length === 1 && ((code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff && code !== 0xad))) out += char;
  }
  return out.trim().slice(0, max).trim();
}

const channel = value => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function luminance(hex) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!match) return null;
  const [r, g, b] = match.slice(1).map(part => channel(parseInt(part, 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  if (la === null || lb === null) return 0;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// A kid's accent sits on the dark screens and carries dark text on its buttons, so both must read.
export const INK = '#0B0C10';
export function accentCheck(hex) {
  const ratio = contrast(hex, INK);
  if (!ratio) return { ok: false, ratio: 0, message: 'Pick a color.' };
  if (ratio >= 4.5) return { ok: true, ratio, message: `Easy to read on the dark screens (${ratio.toFixed(1)} to 1).` };
  return { ok: false, ratio, message: `Hard to read on the dark screens (${ratio.toFixed(1)} to 1). Pick a lighter color.` };
}

// The wizard's swatches: the badge palette minus chalk, which is too close to the text color.
export const ACCENTS = [
  { hex: '#FF5C2B', label: 'Ember' }, { hex: '#C6FF3D', label: 'Volt' }, { hex: '#4DB8FF', label: 'Sky' },
  { hex: '#FF6FB5', label: 'Bubblegum' }, { hex: '#A98BFF', label: 'Grape' }, { hex: '#FFD23F', label: 'Sunny' },
  { hex: '#3DFFB0', label: 'Mint' },
];
export const accentName = hex => ACCENTS.find(item => item.hex.toLowerCase() === String(hex).toLowerCase())?.label || String(hex).toUpperCase();

// A login name from a kid's name: "Zoë Ann" → "zoeann". The server checks it again.
export function handleFrom(name) {
  const base = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const start = base.replace(/^[0-9]+/, '');
  return (start || 'kid').slice(0, 24).padEnd(2, '1');
}

const random = (max, rng) => {
  if (rng) return Math.floor(rng() * max);
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] % max;
};

// Two friendly words a kid can remember and type on a tablet, plus two digits: "sunny-otter-42".
const ADJECTIVES = ['sunny', 'brave', 'happy', 'zippy', 'bouncy', 'fuzzy', 'jolly', 'lucky', 'mighty', 'speedy',
  'sparkly', 'cosmic', 'silly', 'swift', 'gentle', 'clever', 'shiny', 'snowy', 'windy', 'rocket',
  'purple', 'golden', 'silver', 'crispy', 'giant', 'tiny', 'sleepy', 'wild', 'super', 'magic', 'comfy', 'merry'];
const NOUNS = ['otter', 'panda', 'comet', 'pickle', 'tiger', 'rocket', 'koala', 'banjo', 'falcon', 'muffin',
  'dragon', 'pebble', 'turtle', 'walrus', 'cactus', 'noodle', 'meteor', 'puffin', 'button', 'pretzel',
  'lemon', 'gecko', 'robot', 'llama', 'waffle', 'moose', 'planet', 'cookie', 'dolphin', 'hippo', 'kitten', 'bagel'];
export function kidPassword(rng) {
  const adjective = ADJECTIVES[random(ADJECTIVES.length, rng)];
  let noun = NOUNS[random(NOUNS.length, rng)];
  if (noun === adjective) noun = NOUNS[(NOUNS.indexOf(noun) + 1) % NOUNS.length];
  return `${adjective}-${noun}-${String(random(90, rng) + 10)}`;
}

// A parent password a password manager will keep: 4 groups of 5 from an alphabet without look-alikes.
const PASS_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function parentPassword(rng) {
  const groups = [];
  for (let g = 0; g < 4; g++) {
    let group = '';
    for (let i = 0; i < 5; i++) group += PASS_ALPHABET[random(PASS_ALPHABET.length, rng)];
    groups.push(group);
  }
  return groups.join('-');
}

const LOCAL = /^(?:localhost|127(?:\.\d+){3}|\[::1\])$/i;
const PRIVATE = /^(?:10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2}|169\.254(?:\.\d+){2}|[^.]+\.local|[^.]+\.lan|[^.]+\.home\.arpa)$/i;

// What to tell a parent about the web address they typed. level: 'bad' blocks saving, 'warn' and
// 'info' are advice.
export function addressNotes(value, { production = false, current = '' } = {}) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { return [{ level: 'bad', text: 'Use a full web address, like https://videos.example.com.' }]; }
  if (!['http:', 'https:'].includes(url.protocol)) return [{ level: 'bad', text: 'The address starts with https:// or http://.' }];
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    return [{ level: 'bad', text: 'Use just the address, without a path after it.' }];
  }
  const notes = [];
  const host = url.hostname;
  if (url.protocol === 'http:') {
    if (production) notes.push({ level: 'bad', text: 'This install runs in production mode, so it needs an https:// address.' });
    else if (LOCAL.test(host)) notes.push({ level: 'info', text: 'Good for trying it on this computer. Phones and other devices will need the server\'s real address.' });
    else if (PRIVATE.test(host) || /^\d+(?:\.\d+){3}$/.test(host)) {
      notes.push({ level: 'warn', text: 'This is a plain http address on your home network. It works in a browser, but sign-ins are not encrypted and phones can only install the app from an https:// address. Set up HTTPS when you can (the README shows how).' });
    } else {
      notes.push({ level: 'warn', text: 'Plain http is not encrypted. Use https:// for anything on the internet.' });
    }
  }
  if (current && url.origin !== current) {
    notes.push({ level: 'info', text: `After you continue, setup carries on at ${url.origin}/setup, and you sign in there once. Make sure that address reaches this server.` });
  }
  return notes;
}
