import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('focus preferences are connected to library shelves and channel discovery', () => {
  const app = read('../src/main.jsx');
  assert.match(app, /filterVideosForFocus/);
  assert.match(app, /shouldShowRecommendations/);
  assert.match(app, /focusSettings\.hideYouTube/);
  assert.match(app, /showRecommendations &&/);
});

test('notes are autosaved after debounce and flushed when the editor loses focus', () => {
  const app = read('../src/main.jsx');
  assert.match(app, /persistNotesDraft\(videoId, title, content\)/);
  assert.match(app, /onBlur=\{\(\) =>/);
  assert.match(app, /api\.exportNotes/);
});

test('Android watch history rejects transient zero-duration progress samples', () => {
  const platform = read('../src/platform/index.js');
  assert.match(platform, /normalizeProgressSample\(positionSeconds, durationSeconds\)/);
  assert.match(platform, /if \(!sample\)/);
});

test('Android continue-watching excludes completed and untouched videos', () => {
  const platform = read('../src/platform/index.js');
  assert.match(platform, /WHERE h\.completed = 0\s+AND h\.position_seconds > 0/);
});

test('Android YouTube player waits for the final JavaScript progress callback before finishing', () => {
  const activity = read('../android/app/src/main/java/com/localtube/app/YouTubePlayerActivity.java');
  const backHandler = activity.slice(activity.indexOf('public void onBackPressed()'), activity.indexOf('protected void onSaveInstanceState'));
  assert.match(backHandler, /evaluateJavascript\([\s\S]*?value ->/);
  assert.match(backHandler, /value -> \{[\s\S]*?finishWithProgress\(\)/);
});

test('Android library migration uses non-unique lookup indexes to preserve legacy duplicate rows', () => {
  const platform = read('../src/platform/index.js');
  assert.match(platform, /DROP INDEX IF EXISTS videos_unique_source_uri/);
  assert.match(platform, /CREATE INDEX IF NOT EXISTS videos_source_uri_lookup/);
});

test('desktop notes read bridge only reads paths saved by LocalTube', () => {
  const main = read('../electron/main.cjs');
  assert.match(main, /Only read note files previously selected through LocalTube/);
  assert.match(main, /path\.resolve\(row\.value\) === path\.resolve\(requestedPath\)/);
});
