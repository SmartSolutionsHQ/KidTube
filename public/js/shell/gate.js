// The front door (#kt-door). It has three faces:
//   door    every listed kid's badge, "Who's on tape today?", and "Parent? Sign in" when signed out
//   lobby   the backdrop behind the sign-in card: one kid's name in their accent, or the family's
//   note    a plain message with one button (the server can't be reached, nothing to watch yet)
// While it shows, the rest of the page is inert. The kid's splash itself is the theme loader's.
import { accentOf, badgeFor, renderKids } from './picker.js';

const door = () => document.getElementById('kt-door');
const part = name => door().querySelector(`[data-door="${name}"]`);

function show(mode, accent) {
  const root = door();
  root.hidden = false;
  root.dataset.mode = mode;
  root.style.setProperty('--kid', accent || 'var(--tz-flare)');
  document.body.setAttribute('data-locked', '1');
  return root;
}

export function closeDoor() {
  const root = door();
  root.hidden = true;
  root.dataset.mode = '';
}

// Every kid, as big badge buttons. Resolves with { channel } or, signed out, { parent: true }.
export function openDoor({ kicker, channels, parentLink = false, accountLink = false }) {
  const root = show('door');
  root.setAttribute('aria-hidden', 'false');
  part('kicker').textContent = kicker || '';
  part('title').textContent = "Who's on tape today?";
  part('parent').hidden = !parentLink;
  part('account').hidden = !accountLink;
  return new Promise(resolve => {
    renderKids(part('kids'), channels, { onPick: channel => resolve({ channel }) });
    part('parent').onclick = () => resolve({ parent: true });
    part('account').onclick = () => resolve({ account: true });
    part('title').focus({ preventScroll: true });
  });
}

// The still backdrop behind the sign-in card: a kid's badge and name in their accent, or the family.
export function openLobby({ title, kicker, channel }) {
  const root = show('lobby', channel ? accentOf(channel) : '');
  root.setAttribute('aria-hidden', 'true');
  part('kicker').textContent = kicker || '';
  part('title').textContent = title || '';
  const badge = part('badge');
  badge.replaceChildren(...(channel ? [badgeFor(channel)] : []));
  badge.hidden = !channel;
}

export function openNote({ title, text, action, onAction }) {
  const root = show('note');
  root.setAttribute('aria-hidden', 'false');
  part('kicker').textContent = '';
  part('title').textContent = title;
  part('note').textContent = text;
  const button = part('action');
  button.textContent = action;
  button.onclick = onAction;
  button.focus({ preventScroll: true });
}
