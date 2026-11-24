import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTimestamp,
  isPlaybackCompleted,
  isValidYouTubeId,
  normalizeFocusSettings,
  appendTimestamp,
  filterVideosForFocus,
  shouldShowRecommendations,
  normalizeProgressSample,
  getDisplayVideoTitle,
  isUserCancelledPicker
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


test('focus mode hides YouTube catalogue entries when requested', () => {
  const rows = [{ id: 1, isLocal: true }, { id: 2, isLocal: false, youtube_id: 'abcdefghijk' }];
  assert.deepEqual(filterVideosForFocus(rows, { enabled: true, hideYouTube: true }), [rows[0]]);
  assert.deepEqual(filterVideosForFocus(rows, { enabled: false, hideYouTube: true }), rows);
});

test('recommendation visibility follows enabled focus preferences', () => {
  assert.equal(shouldShowRecommendations({ enabled: true, hideRecommendations: true }), false);
  assert.equal(shouldShowRecommendations({ enabled: false, hideRecommendations: true }), true);
  assert.equal(shouldShowRecommendations({ enabled: true, hideRecommendations: false }), true);
});

test('rejects invalid progress samples and clamps valid progress', () => {
  assert.equal(normalizeProgressSample(10, 0), null);
  assert.equal(normalizeProgressSample(-1, 100), null);
  assert.deepEqual(normalizeProgressSample(120, 100), { positionSeconds: 100, durationSeconds: 100, completed: true });
});

test('replaces numeric-only imported titles with human-readable labels', () => {
  assert.equal(getDisplayVideoTitle({ title: '1000118597', isLocal: true }), '1000118597');
  assert.equal(getDisplayVideoTitle({ title: '1000118597', channel_title: 'MercifulServant' }), 'MercifulServant');
  assert.equal(getDisplayVideoTitle({ title: 'A meaningful title' }), 'A meaningful title');
});

test('recognizes Android picker dismissal without treating it as an error', () => {
  assert.equal(isUserCancelledPicker(new Error('pickFiles canceled')), true);
  assert.equal(isUserCancelledPicker({ code: 'CANCELED' }), true);
  assert.equal(isUserCancelledPicker(new Error('Permission denied')), false);
});
