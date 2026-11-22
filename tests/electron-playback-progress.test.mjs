import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeProgressPayload, getSafeResumePosition } =
  require('../electron/playback-progress.cjs');

test('normalizes a valid YouTube playback sample', () => {
  assert.deepEqual(normalizeProgressPayload({
    videoId: '12',
    positionSeconds: 42.5,
    durationSeconds: 300
  }), {
    videoId: 12,
    positionSeconds: 42.5,
    durationSeconds: 300,
    completed: 0
  });
});

test('rejects invalid or transient zero-duration progress samples', () => {
  assert.equal(normalizeProgressPayload({ videoId: 1, positionSeconds: 20, durationSeconds: 0 }), null);
  assert.equal(normalizeProgressPayload({ videoId: 0, positionSeconds: 20, durationSeconds: 30 }), null);
  assert.equal(normalizeProgressPayload({ videoId: 1, positionSeconds: NaN, durationSeconds: 30 }), null);
});

test('marks progress at or beyond ninety percent complete', () => {
  assert.equal(normalizeProgressPayload({
    videoId: 1, positionSeconds: 270, durationSeconds: 300
  }).completed, 1);
});

test('clamps an out-of-range sample to the media duration and marks it complete', () => {
  assert.deepEqual(normalizeProgressPayload({
    videoId: 1, positionSeconds: 400, durationSeconds: 300
  }), {
    videoId: 1, positionSeconds: 300, durationSeconds: 300, completed: 1
  });
});

test('restores an incomplete video from its saved position', () => {
  assert.equal(getSafeResumePosition({
    position_seconds: 82.5, duration_seconds: 300, completed: 0
  }), 82.5);
});

test('restarts completed, invalid, or out-of-range playback records', () => {
  assert.equal(getSafeResumePosition({
    position_seconds: 280, duration_seconds: 300, completed: 1
  }), 0);
  assert.equal(getSafeResumePosition({
    position_seconds: 320, duration_seconds: 300, completed: 0
  }), 0);
  assert.equal(getSafeResumePosition({
    position_seconds: 20, duration_seconds: 0, completed: 0
  }), 0);
});
