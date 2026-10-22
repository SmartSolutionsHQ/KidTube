// Parent controls that other parts of the app add to the dashboard without editing its tabs.
// Each entry is { slot, module }: slot names a place, module is an imported ES module (or any object)
// with mount(host, ctx). The dashboard calls mount once per slot it draws; mount may return a function
// (or an object with destroy()) that runs when that part of the page is redrawn or left.
//
// Slots and their ctx (every ctx also has api, say, refresh and role):
//   'clip-actions'      one per video row on the Videos tab       ctx.clip, ctx.kid
//   'person-settings'   one per account on the People tab        ctx.person
//   'kid-settings'      one per kid in the Kids tab's editor     ctx.kid
//   'family-settings'   once on the Settings tab                 (no extra ctx)
// The full contract is in docs/plan/M7-notes.md.
import * as capsuleActions from '../launch/capsule-actions.js';
import * as tapeBudget from '../launch/tape-budget.js';
import * as kidTape from '../launch/kid-tape.js';
import * as familyClock from '../launch/family-clock.js';

// The launch-story modules read { clip | account | channel } and use the shared account session
// (js/shell/auth-dialog.js), so each one only needs its ctx renamed. Sealing or opening a capsule
// changes the video row, so those redraw it; budget changes are shown by the module itself.
const REDRAW_ON = new Set(['capsule.seal', 'capsule.unseal']);

function adapt(module, launchCtx) {
  return {
    mount(host, ctx) {
      const handle = module.mount(host, launchCtx(ctx));
      const onChange = event => { if (REDRAW_ON.has(event.detail?.kind)) ctx.refresh?.(); };
      host.addEventListener('kt:launch-change', onChange);
      return () => {
        host.removeEventListener('kt:launch-change', onChange);
        handle?.destroy?.();
      };
    },
  };
}

export default [
  { slot: 'clip-actions', module: adapt(capsuleActions, ctx => ({ clip: ctx.clip })) },
  { slot: 'person-settings', module: adapt(tapeBudget, ctx => ({ account: ctx.person })) },
  { slot: 'kid-settings', module: adapt(kidTape, ctx => ({ channel: ctx.kid })) },
  { slot: 'family-settings', module: adapt(familyClock, () => ({})) },
];
