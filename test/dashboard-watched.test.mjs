import test from 'node:test';
import assert from 'node:assert/strict';
import { watchCells, watchState, watchedLabel, viewerLabel, viewsQuery } from '../public/js/parent/watch-model.js';

// The shape GET /api/admin/views answers with (built by the launch-story milestone), stubbed.
const NOW = Date.UTC(2026, 9, 22, 18, 0);
const STUB = {
  ok: true,
  rows: [
    { clipId: 'a1', clipTitle: 'The big build', channel: 'ezra', viewer: 'rosa@example.com', viewerName: 'Rosa Rivera',
      started: NOW - 3600000, seconds: 89, duration: 89, completed: true },
    { clipId: 'b2', clipTitle: 'Volcano that actually works', channel: 'marisa', viewer: 'guest:0a1b2c3d4e5f', viewerName: '',
      started: NOW - 7200000, seconds: 31, duration: 31, completed: true },
    { clipId: 'c3', clipTitle: 'Skate park, take two', channel: 'ezra', viewer: 'marcus@example.com', viewerName: 'Marcus Lee',
      started: NOW - 86400000, seconds: 130, duration: 201, completed: false },
  ],
};

test('a stubbed views answer becomes table rows', () => {
  const state = watchState(STUB);
  assert.equal(state.kind, 'rows');
  assert.equal(state.next, STUB.rows[2].started, 'the next page starts before the oldest row');
  const kidName = slug => ({ ezra: 'Ezra', marisa: 'Marisa' }[slug] || '');
  const guests = new Map([['guest:0a1b2c3d4e5f', 'Grandpa']]);
  const cells = state.rows.map(row => watchCells(row, { kidName, guests, now: NOW, timeZone: 'UTC', locale: 'en-US' }));
  assert.deepEqual(cells.map(({ viewer, video, watched }) => [viewer, video, watched]), [
    ['Rosa Rivera', 'The big build (Ezra)', '1:29 of 1:29'],
    ['Guest (Grandpa)', 'Volcano that actually works (Marisa)', '0:31 of 0:31'],
    ['Marcus Lee', 'Skate park, take two (Ezra)', '2:10 of 3:21'],
  ]);
  assert.equal(cells[0].when, 'Thu 5:00 PM');
});

test('no route yet, no rows, odd rows', () => {
  assert.deepEqual(watchState(null), { kind: 'unavailable', rows: [], next: null }, 'a 404 before launch-story lands');
  assert.equal(watchState({ ok: true, rows: [] }).kind, 'empty');
  assert.equal(watchState({ ok: true }).kind, 'empty');
  assert.equal(watchState({ ok: true, rows: [STUB.rows[0]], next: 123 }).next, 123, 'a server cursor wins');
  assert.equal(viewerLabel({ viewer: 'guest:abcdef123456' }), 'Guest ABCD');
  assert.equal(viewerLabel({ viewer: 'x@example.com' }), 'x@example.com');
  assert.equal(watchedLabel({ seconds: 500, duration: 60 }), '1:00 of 1:00', 'never more than the video');
  assert.equal(watchedLabel({ seconds: 75 }), '1:15');
  assert.equal(watchCells({ clipTitle: '', started: 'x' }).video, 'A deleted video');
  assert.equal(viewsQuery({ channel: 'ezra', viewer: 'guest:abc', before: 5 }), '/api/admin/views?channel=ezra&viewer=guest%3Aabc&before=5&limit=50');
  assert.equal(viewsQuery({ limit: 0 }), '/api/admin/views');
});
