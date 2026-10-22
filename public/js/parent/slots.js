// Mounts the extensions registered for a slot (see extensions.js) into a host element. A broken
// extension is logged and skipped, so it can never take the dashboard down with it.
import registered from './extensions.js';

export const SLOTS = ['clip-actions', 'person-settings', 'kid-settings', 'family-settings'];

export function mountSlot(host, slot, ctx, list = registered) {
  if (!SLOTS.includes(slot)) throw new Error(`Unknown dashboard slot ${slot}`);
  const cleanups = [];
  for (const entry of list) {
    if (entry?.slot !== slot || typeof entry.module?.mount !== 'function') continue;
    const box = host.ownerDocument.createElement('div');
    box.className = 'kd-slot';
    box.dataset.slot = slot;
    host.append(box);
    try {
      const result = entry.module.mount(box, ctx);
      if (typeof result === 'function') cleanups.push(result);
      else if (typeof result?.destroy === 'function') cleanups.push(() => result.destroy());
    } catch (error) {
      console.error(`Dashboard extension in ${slot} failed`, error);
      box.remove();
    }
  }
  return () => { for (const cleanup of cleanups.splice(0)) { try { cleanup(); } catch (error) { console.error(error); } } };
}
