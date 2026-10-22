// The home-screen app, on the page side. Loading this module registers the service worker (only in a
// secure context: https, or localhost while testing) and keeps Android's install offer for later.
// The install page calls mountInstall() to show the right way to add the app on this device.

let offer = null;
const offerListeners = new Set();

export function secureEnough() {
  return window.isSecureContext === true && 'serviceWorker' in navigator;
}

export function registerWorker() {
  if (!secureEnough()) return Promise.resolve(null);
  return navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(error => {
    console.warn('The home-screen app could not start its offline helper.', error);
    return null;
  });
}

// iPadOS reports itself as a Mac; a touch screen gives it away.
export function platform(nav = navigator) {
  const agent = nav.userAgent || '';
  if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && nav.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(agent)) return 'android';
  return 'desktop';
}

export function installed() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

window.addEventListener('beforeinstallprompt', event => {
  // Chrome would show its own mini-bar; the install page offers a button instead.
  event.preventDefault();
  offer = event;
  for (const listener of offerListeners) listener(offer);
});
window.addEventListener('appinstalled', () => { offer = null; for (const listener of offerListeners) listener(null); });

export function mountInstall(root) {
  const part = name => root.querySelector(`[data-ki="${name}"]`);
  const prompt = root.querySelector('[data-way="prompt"]');
  root.dataset.platform = platform();
  part('installed').hidden = !installed();
  part('insecure').hidden = window.isSecureContext === true;

  const show = current => { prompt.hidden = !current || installed(); };
  offerListeners.add(show);
  show(offer);
  part('install').addEventListener('click', async () => {
    if (!offer) return;
    const asked = offer;
    offer = null;
    await asked.prompt();
    const { outcome } = await asked.userChoice;
    part('result').textContent = outcome === 'accepted'
      ? 'Added. Look for the icon on your home screen.'
      : 'Not added. You can do it later from the browser menu.';
    part('install').hidden = true;
  });
}

registerWorker();
