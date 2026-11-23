
import { registerPlugin, Capacitor } from '@capacitor/core';
import { normalizeProgressSample, isUserCancelledPicker } from '../lib/playback-utils.mjs';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import {
  CapacitorSQLite,
  SQLiteConnection
} from '@capacitor-community/sqlite';

const LocalMedia = registerPlugin('LocalMedia');
const LocalPlayer = registerPlugin('LocalPlayer');
const YouTubePlayer = registerPlugin('YouTubePlayer');

let androidDbPromise;

const MAX_QUERY_LENGTH = 200;
const MAX_TAG_LENGTH = 1000;

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getErrorMessage(error) {
  return error?.message || String(error || 'Unknown error');
}

/* -------------------------------------------------------
   ANDROID DATABASE
------------------------------------------------------- */

async function getAndroidDb() {
  if (!androidDbPromise) {
    androidDbPromise = (async () => {
      const sqlite = new SQLiteConnection(CapacitorSQLite);

      const consistency = await sqlite.checkConnectionsConsistency();
      const connection = await sqlite.isConnection('localtube', false);

      let db;

      if (consistency.result && connection.result) {
        db = await sqlite.retrieveConnection('localtube', false);
      } else {
        db = await sqlite.createConnection(
          'localtube',
          false,
          'no-encryption',
          1,
          false
        );
      }

      await db.open();

      // Create the original tables FIRST.
      // This is essential for a fresh installation.
      await db.execute(`
        CREATE TABLE IF NOT EXISTS videos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          channel_title TEXT DEFAULT '',
          channel_id TEXT DEFAULT '',
          youtube_id TEXT DEFAULT '',
          youtube_url TEXT DEFAULT '',
          file_path TEXT DEFAULT '',
          thumbnail_url TEXT DEFAULT '',
          description TEXT DEFAULT '',
          tags TEXT DEFAULT '',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS bookmarks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          video_id INTEGER NOT NULL UNIQUE,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS video_notes (
          video_id INTEGER PRIMARY KEY,
          content TEXT NOT NULL DEFAULT '',
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS watch_history (
          video_id INTEGER PRIMARY KEY,
          position_seconds REAL NOT NULL DEFAULT 0,
          duration_seconds REAL NOT NULL DEFAULT 0,
          completed INTEGER NOT NULL DEFAULT 0,
          last_watched_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
        );
      `);

      // Safe migration for databases created by older versions.
      const columns = await db.query('PRAGMA table_info(videos)');

      const hasSourceUri = (columns.values || []).some(
        column => column.name === 'source_uri'
      );

      if (!hasSourceUri) {
        await db.execute(`
          ALTER TABLE videos
          ADD COLUMN source_uri TEXT DEFAULT ''
        `);
      }

      // Create indexes only AFTER tables and migration exist.
      // Older databases may already contain duplicate catalogue entries.
      // Rebuild lookup indexes as non-unique so an upgrade never fails or
      // requires deleting user rows. Import code performs duplicate checks.
      await db.execute(`
        DROP INDEX IF EXISTS videos_unique_source_uri;
        DROP INDEX IF EXISTS videos_unique_local_path;
        DROP INDEX IF EXISTS videos_unique_youtube_id;

        CREATE INDEX IF NOT EXISTS videos_source_uri_lookup
        ON videos(source_uri);

        CREATE INDEX IF NOT EXISTS videos_local_path_lookup
        ON videos(file_path);

        CREATE INDEX IF NOT EXISTS videos_youtube_id_lookup
        ON videos(youtube_id);

        CREATE INDEX IF NOT EXISTS watch_history_recent
        ON watch_history(last_watched_at DESC);
      `);

      return db;
    })().catch(error => {
      // Allow a later call to retry initialization.
      androidDbPromise = null;
      throw error;
    });
  }

  return androidDbPromise;
}

/* -------------------------------------------------------
   VIDEO MAPPING AND FILE EXISTENCE
------------------------------------------------------- */

function mapVideo(row) {
  return {
    ...row,
    isLocal: Boolean(row.file_path),
    bookmarked: Boolean(row.bookmarked),
    fileExists: false,
    progressSeconds: asNumber(row.position_seconds),
    durationSeconds: asNumber(row.duration_seconds),
    completed: Boolean(row.completed)
  };
}

async function enrichVideos(rows) {
  const videos = (rows || []).map(mapVideo);

  await Promise.all(
    videos.map(async video => {
      if (!video.file_path) {
        video.fileExists = false;
        return;
      }

      try {
        const result = await LocalMedia.fileExists({
          path: video.file_path
        });

        video.fileExists = Boolean(result?.exists);
      } catch (error) {
        console.warn(
          '[LocalTube] Could not check file:',
          video.file_path,
          error
        );

        video.fileExists = false;
      }
    })
  );

  return videos;
}

/* -------------------------------------------------------
   LIST VIDEOS
------------------------------------------------------- */

async function androidListVideos(options = {}) {
  const db = await getAndroidDb();

  const {
    type = 'all',
    channelId = '',
    query = '',
    bookmarkedOnly = false
  } = options || {};

  let sql = `
    SELECT
      v.*,

      EXISTS (
        SELECT 1
        FROM bookmarks b
        WHERE b.video_id = v.id
      ) AS bookmarked,

      COALESCE(h.position_seconds, 0) AS position_seconds,
      COALESCE(h.duration_seconds, 0) AS duration_seconds,
      COALESCE(h.completed, 0) AS completed

    FROM videos v

    LEFT JOIN watch_history h
      ON h.video_id = v.id

    WHERE 1 = 1
  `;

  const values = [];

  if (type === 'local') {
    sql += " AND v.file_path <> ''";
  } else if (type === 'youtube') {
    sql += " AND v.youtube_id <> '' AND v.file_path = ''";
  }

  if (channelId) {
    sql += ' AND v.channel_id = ?';
    values.push(String(channelId));
  }

  if (bookmarkedOnly) {
    sql += `
      AND EXISTS (
        SELECT 1
        FROM bookmarks b
        WHERE b.video_id = v.id
      )
    `;
  }

  const searchTerm = String(query || '')
    .trim()
    .slice(0, MAX_QUERY_LENGTH);

  if (searchTerm) {
    sql += `
      AND (
        v.title LIKE ? OR
        v.channel_title LIKE ? OR
        v.tags LIKE ? OR
        v.description LIKE ?
      )
    `;

    const term = `%${searchTerm}%`;
    values.push(term, term, term, term);
  }

  sql += ' ORDER BY v.created_at DESC, v.id DESC LIMIT 1000';

  const result = await db.query(sql, values);

  return enrichVideos(result.values || []);
}

/* -------------------------------------------------------
   CHANNELS
------------------------------------------------------- */

async function androidListChannels() {
  const db = await getAndroidDb();

  const result = await db.query(`
    SELECT
      channel_id AS channelId,
      channel_title AS channelTitle,
      COUNT(*) AS videoCount,
      MAX(created_at) AS importedAt

    FROM videos

    WHERE youtube_id <> ''
      AND file_path = ''
      AND channel_id <> ''

    GROUP BY channel_id, channel_title

    ORDER BY channel_title COLLATE NOCASE
  `);

  return result.values || [];
}

/* -------------------------------------------------------
   BOOKMARKS
------------------------------------------------------- */

async function androidToggleBookmark(id) {
  const db = await getAndroidDb();
  const videoId = Number(id);

  const existing = await db.query(
    'SELECT id FROM bookmarks WHERE video_id = ?',
    [videoId]
  );

  if (existing.values?.length) {
    await db.run(
      'DELETE FROM bookmarks WHERE video_id = ?',
      [videoId]
    );
  } else {
    await db.run(
      'INSERT OR IGNORE INTO bookmarks(video_id) VALUES(?)',
      [videoId]
    );
  }

  return androidListVideos();
}

/* -------------------------------------------------------
   TAGS
------------------------------------------------------- */

async function androidUpdateTags({ id, tags }) {
  const db = await getAndroidDb();

  await db.run(
    'UPDATE videos SET tags = ? WHERE id = ?',
    [
      String(tags || '').slice(0, MAX_TAG_LENGTH),
      Number(id)
    ]
  );

  return androidListVideos();
}

/* -------------------------------------------------------
   NOTES
------------------------------------------------------- */

// Android notes are stored in SQLite.
// The URI is an internal reference, not a physical .txt file.
async function androidLoadNotesPath(videoId) {
  return `localtube-note://${Number(videoId)}`;
}

async function androidReadNotes(notePath) {
  const match = String(notePath || '').match(
    /^localtube-note:\/\/(\d+)$/
  );

  if (!match) return '';

  const db = await getAndroidDb();

  const result = await db.query(
    'SELECT content FROM video_notes WHERE video_id = ?',
    [Number(match[1])]
  );

  return result.values?.[0]?.content || '';
}

async function androidSaveNotes({ videoId, content }) {
  const db = await getAndroidDb();

  await db.run(
    `
      INSERT INTO video_notes (
        video_id,
        content,
        updated_at
      )
      VALUES (?, ?, CURRENT_TIMESTAMP)

      ON CONFLICT(video_id)
      DO UPDATE SET
        content = excluded.content,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      Number(videoId),
      String(content || '')
    ]
  );

  return {
    canceled: false,
    filePath: `localtube-note://${Number(videoId)}`
  };
}
async function androidExportNotes({ videoId, title, content }) {
  return LocalMedia.exportText({
    fileName: `${String(title || 'LocalTube Notes')
      .replace(/[<>:"/\\|?*]/g, '_')}.txt`,
    content: String(content || '')
  });
}

/* -------------------------------------------------------
   WATCH HISTORY
------------------------------------------------------- */

async function androidRecordProgress({
  videoId,
  positionSeconds = 0,
  durationSeconds = 0
}) {
  const db = await getAndroidDb();

  const id = Number(videoId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid video ID for playback progress.');
  }

  // Ignore transient samples while the YouTube iframe/ExoPlayer is starting
  // or closing. A zero duration must never erase a previously saved position.
  const sample = normalizeProgressSample(positionSeconds, durationSeconds);
  if (!sample) {
    return { success: false, ignored: true };
  }

  const position = sample.positionSeconds;
  const duration = sample.durationSeconds;
  const completed = sample.completed ? 1 : 0;

  await db.run(
    `
      INSERT INTO watch_history (
        video_id,
        position_seconds,
        duration_seconds,
        completed,
        last_watched_at
      )
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)

      ON CONFLICT(video_id)
      DO UPDATE SET
        position_seconds = excluded.position_seconds,
        duration_seconds = excluded.duration_seconds,
        completed = excluded.completed,
        last_watched_at = CURRENT_TIMESTAMP
    `,
    [id, position, duration, completed]
  );

  return {
    success: true,
    completed: Boolean(completed)
  };
}

async function androidGetHistory(limit = 30) {
  const db = await getAndroidDb();

  const safeLimit = Math.max(
    1,
    Math.min(100, Number(limit) || 30)
  );

  const result = await db.query(
    `
      SELECT
        v.*,
        COALESCE(h.position_seconds, 0) AS position_seconds,
        COALESCE(h.duration_seconds, 0) AS duration_seconds,
        COALESCE(h.completed, 0) AS completed,
        h.last_watched_at,

        EXISTS (
          SELECT 1
          FROM bookmarks b
          WHERE b.video_id = v.id
        ) AS bookmarked

      FROM watch_history h

      INNER JOIN videos v
        ON v.id = h.video_id

      WHERE h.completed = 0
        AND h.position_seconds > 0

      ORDER BY h.last_watched_at DESC

      LIMIT ?
    `,
    [safeLimit]
  );

  return enrichVideos(result.values || []);
}

/* -------------------------------------------------------
   RECOMMENDATIONS
------------------------------------------------------- */

async function androidGetRecommendations(limit = 20) {
  const db = await getAndroidDb();

  const safeLimit = Math.max(
    1,
    Math.min(100, Number(limit) || 20)
  );

  const result = await db.query(
    `
      SELECT
        v.*,

        EXISTS (
          SELECT 1
          FROM bookmarks b
          WHERE b.video_id = v.id
        ) AS bookmarked,

        COALESCE(h.position_seconds, 0) AS position_seconds,
        COALESCE(h.duration_seconds, 0) AS duration_seconds,
        COALESCE(h.completed, 0) AS completed

      FROM videos v

      LEFT JOIN watch_history h
        ON h.video_id = v.id

      WHERE v.id NOT IN (
        SELECT video_id
        FROM watch_history
        WHERE completed = 1
      )

      ORDER BY

        CASE
          WHEN EXISTS (
            SELECT 1
            FROM bookmarks b
            WHERE b.video_id = v.id
          )
          THEN 0 ELSE 1
        END,

        CASE
          WHEN h.video_id IS NULL
          THEN 0 ELSE 1
        END,

        v.created_at DESC

      LIMIT ?
    `,
    [safeLimit]
  );

  return enrichVideos(result.values || []);
}

/* -------------------------------------------------------
   LOCAL VIDEO IMPORT
------------------------------------------------------- */

async function androidImportFiles() {
  const db = await getAndroidDb();

  let pickerResult;
  try {
    pickerResult = await FilePicker.pickVideos({ limit: 0 });
  } catch (error) {
    // Android's document picker can reject with "pickFiles canceled"
    // when the user simply presses Back. Treat that as a normal dismissal.
    if (isUserCancelledPicker(error)) {
      return { cancelled: true, addedCount: 0, skippedCount: 0, errors: [] };
    }
    throw error;
  }

  const files = pickerResult?.files || [];

  if (!files.length) {
    return {
      cancelled: true,
      addedCount: 0,
      skippedCount: 0,
      errors: []
    };
  }

  let addedCount = 0;
  let skippedCount = 0;

  const errors = [];

  for (const file of files) {
    let copiedPath = '';

    try {
      if (!file.path) {
        throw new Error(
          `No accessible URI for ${file.name || 'video'}`
        );
      }

      const sourceUri = String(file.path);
      const originalName = file.name || 'video';

      const title =
        originalName.replace(/\.[^/.]+$/, '') ||
        'Untitled video';

      // Check duplicate original URI.
      const duplicateSource = await db.query(
        `
          SELECT id
          FROM videos
          WHERE source_uri = ?
          LIMIT 1
        `,
        [sourceUri]
      );

      if (duplicateSource.values?.length) {
        skippedCount++;
        continue;
      }

      // Copy the content URI into LocalTube private storage.
      const copied = await LocalMedia.copyVideo({
        uri: sourceUri,
        fileName: originalName
      });

      if (!copied?.path) {
        throw new Error(
          'Android did not return the copied video path.'
        );
      }

      copiedPath = String(copied.path);

      // Also check the destination path before inserting.
      const duplicatePath = await db.query(
        `
          SELECT id
          FROM videos
          WHERE file_path = ?
          LIMIT 1
        `,
        [copiedPath]
      );

      if (duplicatePath.values?.length) {
        skippedCount++;
        continue;
      }

      const insertResult = await db.run(
        `
          INSERT OR IGNORE INTO videos (
            title,
            channel_title,
            channel_id,
            youtube_id,
            youtube_url,
            file_path,
            thumbnail_url,
            description,
            tags,
            source_uri
          )
          VALUES (?, '', '', '', '', ?, '', '', '', ?)
        `,
        [title, copiedPath, sourceUri]
      );

      const changes = Number(
        insertResult?.changes?.changes ??
        insertResult?.changes ??
        0
      );

      if (changes > 0) {
        addedCount++;
      } else {
        skippedCount++;
      }
    } catch (error) {
      console.error(
        '[LocalTube] Import failed:',
        file.name,
        error
      );

      errors.push(
        `${file.name || 'Video'}: ${getErrorMessage(error)}`
      );
    }
  }

  return {
    addedCount,
    skippedCount,
    errors
  };
}

/* -------------------------------------------------------
   YOUTUBE DATA API V3 CHANNEL IMPORT
------------------------------------------------------- */

async function androidFetchChannel({ channelUrl, apiKey }) {
  const key = String(apiKey || '').trim();
  const input = String(channelUrl || '').trim();

  if (!key) {
    throw new Error('Enter your YouTube Data API key.');
  }

  if (!input) {
    throw new Error(
      'Enter a YouTube channel URL or handle.'
    );
  }

  let channelId = '';
  let handle = '';

  const idMatch = input.match(/UC[a-zA-Z0-9_-]{22}/);

  if (idMatch) {
    channelId = idMatch[0];
  } else {
    const handleMatch = input.match(
      /@([a-zA-Z0-9._-]+)/
    );

    if (handleMatch) {
      handle = handleMatch[1];
    } else if (/^@?[a-zA-Z0-9._-]+$/.test(input)) {
      handle = input.replace(/^@/, '');
    } else {
      throw new Error(
        'Enter a valid YouTube channel URL, UC channel ID, or @handle.'
      );
    }
  }

  const base =
    'https://www.googleapis.com/youtube/v3/';

  async function youtubeRequest(endpoint, params) {
    const url = new URL(base + endpoint);

    Object.entries({
      ...params,
      key
    }).forEach(([name, value]) => {
      if (
        value !== undefined &&
        value !== null &&
        value !== ''
      ) {
        url.searchParams.set(name, String(value));
      }
    });

    let response;
    let data;

    try {
      response = await fetch(url.toString());
      data = await response.json();
    } catch (error) {
      throw new Error(
        'Could not reach YouTube. Check your internet connection and try again.'
      );
    }

    if (!response.ok || data.error) {
      const reason = data.error?.errors?.[0]?.reason;
      const message =
        data.error?.message ||
        'YouTube API request failed.';

      throw new Error(
        reason ? `${message} (${reason})` : message
      );
    }

    return data;
  }

  const channelData = await youtubeRequest(
    'channels',
    {
      part: 'id,snippet,contentDetails',
      ...(channelId
        ? { id: channelId }
        : { forHandle: handle })
    }
  );

  const channel = channelData.items?.[0];

  if (!channel) {
    throw new Error(
      'Channel not found. Check the URL, handle and API key.'
    );
  }

  const uploadsPlaylist =
    channel.contentDetails?.relatedPlaylists?.uploads;

  if (!uploadsPlaylist) {
    throw new Error(
      'Could not find this channel uploads playlist.'
    );
  }

  const collected = [];
  const seenIds = new Set();

  let pageToken = '';

  // Up to five pages, 50 videos per page.
  for (let page = 0; page < 5; page++) {
    const pageData = await youtubeRequest(
      'playlistItems',
      {
        part: 'snippet,contentDetails',
        playlistId: uploadsPlaylist,
        maxResults: 50,
        ...(pageToken ? { pageToken } : {})
      }
    );

    for (const entry of pageData.items || []) {
      const snippet = entry.snippet || {};

      const youtubeId =
        entry.contentDetails?.videoId ||
        snippet.resourceId?.videoId;

      if (!youtubeId || seenIds.has(youtubeId)) {
        continue;
      }

      seenIds.add(youtubeId);

      collected.push({
        title: snippet.title || 'Untitled',
        channelTitle: channel.snippet?.title || '',
        channelId: channel.id,
        youtubeId,
        youtubeUrl:
          `https://www.youtube.com/watch?v=${youtubeId}`,
        thumbnailUrl:
          snippet.thumbnails?.medium?.url ||
          snippet.thumbnails?.high?.url ||
          snippet.thumbnails?.default?.url ||
          '',
        description: snippet.description || ''
      });
    }

    pageToken = pageData.nextPageToken || '';

    if (!pageToken) break;
  }

  const db = await getAndroidDb();

  let addedCount = 0;
  let skippedCount = 0;

  for (const item of collected) {
    const existing = await db.query(
      `
        SELECT id
        FROM videos
        WHERE youtube_id = ?
        LIMIT 1
      `,
      [item.youtubeId]
    );

    if (existing.values?.length) {
      skippedCount++;
      continue;
    }

    const insertResult = await db.run(
      `
        INSERT OR IGNORE INTO videos (
          title,
          channel_title,
          channel_id,
          youtube_id,
          youtube_url,
          file_path,
          thumbnail_url,
          description,
          tags
        )
        VALUES (?, ?, ?, ?, ?, '', ?, ?, '')
      `,
      [
        item.title,
        item.channelTitle,
        item.channelId,
        item.youtubeId,
        item.youtubeUrl,
        item.thumbnailUrl,
        item.description
      ]
    );

    const changes = Number(
      insertResult?.changes?.changes ??
      insertResult?.changes ??
      0
    );

    if (changes > 0) {
      addedCount++;
    } else {
      skippedCount++;
    }
  }

  return {
    channelTitle: channel.snippet?.title || '',
    channelId: channel.id,
    addedCount,
    skippedCount,
    totalFetched: collected.length,

    videos: await androidListVideos({
      type: 'youtube',
      channelId: channel.id
    })
  };
}

/* -------------------------------------------------------
   OPEN VIDEO PLAYER
------------------------------------------------------- */

async function androidOpenPlayer(videoId) {
  const db = await getAndroidDb();

  const result = await db.query(
    `
      SELECT
        id,
        title,
        file_path,
        youtube_id

      FROM videos

      WHERE id = ?

      LIMIT 1
    `,
    [Number(videoId)]
  );

  const video = result.values?.[0];

  if (!video) {
    throw new Error(
      'Video not found in your LocalTube library.'
    );
  }

  // YouTube playback.
  if (!video.file_path) {
    if (!video.youtube_id) {
      throw new Error(
        'This video does not have a playable source.'
      );
    }

    const historyResult = await db.query(
      `SELECT position_seconds, duration_seconds, completed
       FROM watch_history WHERE video_id = ? LIMIT 1`,
      [Number(video.id)]
    );
    const saved = historyResult.values?.[0];
    const savedPosition = Math.max(0, asNumber(saved?.position_seconds));
    const savedDuration = Math.max(0, asNumber(saved?.duration_seconds));
    const resumePositionSeconds =
      saved && !Boolean(saved.completed) && savedDuration > 0 &&
      savedPosition < savedDuration
        ? savedPosition
        : 0;

    const playbackResult = await YouTubePlayer.play({
      videoId: video.youtube_id,
      title: video.title || 'LocalTube',
      startPositionSeconds: resumePositionSeconds
    });

if (
  playbackResult &&
  playbackResult.videoId &&
  !playbackResult.cancelled
) {
  await androidRecordProgress({
    videoId: video.id,
    positionSeconds: playbackResult.positionSeconds || 0,
    durationSeconds: playbackResult.durationSeconds || 0
  });
}

return playbackResult;
  }

  // Local video playback.
  const fileCheck = await LocalMedia.fileExists({ path: video.file_path });
  if (!fileCheck?.exists) {
    throw new Error('This local video file is missing or cannot be read. Re-import it to restore playback.');
  }

  const id = String(video.id);

  let checkpoint = {
    positionMs: 0,
    durationMs: 0
  };

  try {
    checkpoint = await LocalPlayer.getCheckpoint({
      videoId: id
    });
  } catch (error) {
    console.warn(
      '[LocalTube] Could not recover playback checkpoint:',
      error
    );
  }

  const resumePositionMs = Math.max(
    0,
    asNumber(checkpoint?.positionMs)
  );

  const checkpointDurationSeconds =
    Math.max(
      0,
      asNumber(checkpoint?.durationMs)
    ) / 1000;

  // Save a recovered checkpoint before playback starts.
  if (
    resumePositionMs > 0 ||
    checkpointDurationSeconds > 0
  ) {
    await androidRecordProgress({
      videoId: video.id,
      positionSeconds: resumePositionMs / 1000,
      durationSeconds: checkpointDurationSeconds
    });
  }

  const playbackResult = await LocalPlayer.play({
    path: video.file_path,
    title: video.title || 'LocalTube',
    videoId: id,
    resumePositionMs
  });

  // Save the final player position when Android returns it.
  if (
    playbackResult &&
    playbackResult.videoId
  ) {
    await androidRecordProgress({
      videoId: video.id,
      positionSeconds: playbackResult.positionSeconds,
      durationSeconds: playbackResult.durationSeconds
    });
  }

  try {
    await LocalPlayer.clearCheckpoint({
      videoId: id
    });
  } catch (error) {
    console.warn(
      '[LocalTube] Could not clear playback checkpoint:',
      error
    );
  }

  return playbackResult;
}

/* -------------------------------------------------------
   PLATFORM API
------------------------------------------------------- */

function unavailable(feature) {
  return async () => {
    throw new Error(
      `${feature} is not connected yet.`
    );
  };
}

async function androidGetFocusSettings() {
  const db = await getAndroidDb();
  const result = await db.query(
    'SELECT key, value FROM settings WHERE key LIKE ?',
    ['focus:%']
  );
  const settings = {};
  for (const row of result.values || []) {
    const key = String(row.key || '').replace(/^focus:/, '');
    try {
      settings[key] = JSON.parse(row.value);
    } catch (error) {
      console.warn('[LocalTube] Ignoring invalid focus preference:', key);
    }
  }
  return settings;
}

async function androidSaveFocusSettings(values = {}) {
  const db = await getAndroidDb();
  const allowed = ['enabled', 'hideYouTube', 'hideRecommendations', 'hideShorts'];
  for (const key of allowed) {
    if (typeof values[key] === 'boolean') {
      await db.run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [`focus:${key}`, JSON.stringify(values[key])]
      );
    }
  }
  return { saved: true };
}

function createAndroidApi() {
  return {
    exportNotes: androidExportNotes,
    listVideos: androidListVideos,
    listChannels: androidListChannels,

    toggleBookmark: androidToggleBookmark,
    updateTags: androidUpdateTags,

    loadNotesPath: androidLoadNotesPath,
    readNotes: androidReadNotes,
    saveNotes: androidSaveNotes,

    importFiles: androidImportFiles,
    fetchChannel: androidFetchChannel,

    openPlayer: androidOpenPlayer,

    getVideoUrl: unavailable(
      'Android video URL access'
    ),

    getHistory: androidGetHistory,
    recordProgress: androidRecordProgress,
    getRecommendations: androidGetRecommendations,
    getFocusSettings: androidGetFocusSettings,
    saveFocusSettings: androidSaveFocusSettings,

    getDataPath: async () =>
      'LocalTube Android private database'
  };
}

export function createPlatformApi() {
  // Electron takes priority because Capacitor can report "web"
  // inside the Electron renderer.
  if (window.localTube) {
    return window.localTube;
  }

  if (Capacitor.getPlatform() === 'android') {
    return createAndroidApi();
  }

    return {
    listVideos: unavailable('Browser database preview'),
    listChannels: unavailable('Browser database preview'),

    toggleBookmark: unavailable('Browser database preview'),
    updateTags: unavailable('Browser database preview'),

    loadNotesPath: unavailable('Browser database preview'),
    readNotes: unavailable('Browser database preview'),
    saveNotes: unavailable('Browser database preview'),
    exportNotes: unavailable('Browser notes export'),

    importFiles: unavailable('Browser file picker'),
    fetchChannel: unavailable('Browser channel import'),

    openPlayer: unavailable('Browser video player'),
    getVideoUrl: unavailable('Browser video playback'),

    getHistory: unavailable('Browser database'),
    recordProgress: unavailable('Browser database'),
    getRecommendations: unavailable('Browser database'),

    getDataPath: unavailable('Browser database')
  };
}
