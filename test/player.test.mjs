import test from 'node:test';
import assert from 'node:assert/strict';
import { playClip, retryClip } from '../public/js/player-media-v1.js';

function fixture() {
  const video = {
    loads: 0, plays: 0, error: null, networkState: 1,
    load() { this.loads++; this.error = null; this.networkState = 1; },
    play() { this.plays++; return Promise.resolve(); },
  };
  return { video, slide: { dataset: { state: 'ready' }, querySelector: () => video } };
}

test('activating a clip recovers a failed preload and queues playback again', () => {
  const { video, slide } = fixture();
  slide.dataset.state = 'error';
  video.error = { code: 2 };
  video.networkState = 3;
  playClip(slide, { muted: false });
  assert.equal(video.loads, 1);
  assert.equal(video.plays, 1);
  assert.equal(video.muted, false);
  assert.equal(slide.dataset.state, 'loading');
});

test('manual retry resumes the active clip instead of leaving it paused after load', () => {
  const { video, slide } = fixture();
  slide.dataset.state = 'error';
  retryClip(slide, { play: true });
  assert.equal(video.loads, 1);
  assert.equal(video.plays, 1);
  retryClip(slide, { play: false });
  assert.equal(video.loads, 2);
  assert.equal(video.plays, 1, 'retrying an inactive clip must not autoplay it');
});

test('healthy and duration-blocked clips do not reload', () => {
  const { video, slide } = fixture();
  playClip(slide);
  assert.equal(video.loads, 0);
  assert.equal(video.plays, 1);
  slide.dataset.invalid = '1';
  playClip(slide);
  assert.equal(video.plays, 1);
});

test('an autoplay rejection remains recoverable by a later user play', async () => {
  const { video, slide } = fixture();
  video.play = () => Promise.reject(new Error('Autoplay blocked'));
  playClip(slide);
  await Promise.resolve();
  assert.equal(slide.dataset.paused, '1');
  assert.equal(slide.dataset.state, 'ready');
  assert.equal(video.loads, 0);
});
