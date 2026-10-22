// Parent controls that other parts of the app add to the dashboard without editing its tabs.
// Each entry is { slot, module }: slot names a place, module is an imported ES module (or any object)
// with mount(host, ctx). The dashboard calls mount once per slot it draws; mount may return a function
// (or an object with destroy()) that runs when that part of the page is redrawn or left.
//
//   import * as watchBudget from './watch-budget.js';
//   export default [{ slot: 'person-settings', module: watchBudget }];
//
// Slots and their ctx (every ctx also has api, say, refresh and role):
//   'clip-actions'      one per video row on the Videos tab       ctx.clip, ctx.kid
//   'person-settings'   one per account on the People tab        ctx.person
//   'kid-settings'      one per kid in the Kids tab's editor     ctx.kid
// The full contract is in docs/plan/M7-notes.md.
export default [];
