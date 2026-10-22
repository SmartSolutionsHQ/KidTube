import { mountInstall } from '/js/shell/pwa.js';

mountInstall(document.body);

// The family's own name, when it has one.
fetch('/api/site').then(response => response.json()).then(site => {
  const name = site?.siteName?.trim();
  if (name) document.querySelector('[data-ki="title"]').textContent = `Add ${name} to your home screen`;
}).catch(() => {});
