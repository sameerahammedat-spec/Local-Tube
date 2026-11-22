import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTimestamp,
  isPlaybackCompleted,
  isValidYouTubeId,
  normalizeFocusSettings,
  appendTimestamp
} from '../src/lib/playback-utils.mjs';

test('formats timestamps below one hour as mm:ss', () => {
  assert.equal(formatTimestamp(0), '[00:00]');
  assert.equal(formatTimestamp(65.9), '[01:05]');
});

test('formats timestamps above one hour as hh:mm:ss', () => {
  assert.equal(formatTimestamp(3661), '[01:01:01]');
});

test('clamps negative and invalid timestamp values to zero', () => {
  assert.equal(formatTimestamp(-8), '[00:00]');
  assert.equal(formatTimestamp('not-a-number'), '[00:00]');
});

test('marks playback complete at the configured threshold', () => {
  assert.equal(isPlaybackCompleted(90, 100), true);
  assert.equal(isPlaybackCompleted(89, 100), false);
});

test('rejects invalid playback duration and thresholds', () => {
  assert.equal(isPlaybackCompleted(20, 0), false);
  assert.equal(isPlaybackCompleted(NaN, 100), false);
  assert.equal(isPlaybackCompleted(100, 100, 0), false);
});

test('validates exact YouTube video ID shape', () => {
  assert.equal(isValidYouTubeId('abcdefghijk'), true);
  assert.equal(isValidYouTubeId('short'), false);
  assert.equal(isValidYouTubeId('abcdefghij!'), false);
});

test('merges only boolean focus preferences with safe defaults', () => {
  assert.deepEqual(normalizeFocusSettings({ hideShorts: false, enabled: 'yes' }), {
    enabled: true,
    hideYouTube: true,
    hideRecommendations: true,
    hideShorts: false
  });
});

test('appends a timestamp without losing existing notes', () => {
  assert.equal(appendTimestamp('Lesson notes', 75), 'Lesson notes\n[01:15] ');
  assert.equal(appendTimestamp('Lesson notes\n', 75), 'Lesson notes\n[01:15] ');
});
