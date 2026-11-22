import { registerPlugin } from '@capacitor/core';
import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

const LocalMedia = registerPlugin('LocalMedia');
const LocalPlayer = registerPlugin('LocalPlayer');
let androidDbPromise;


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

        CREATE UNIQUE INDEX IF NOT EXISTS videos_unique_local_path
        ON videos(file_path) WHERE file_path <> '';

        CREATE UNIQUE INDEX IF NOT EXISTS videos_unique_youtube_id
        ON videos(youtube_id) WHERE youtube_id <> '';

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
      `);

      return db;
    })().catch(error => {
      androidDbPromise = null;
      throw error;
    });
  }

  return androidDbPromise;
}

function mapVideo(row) {
  return {
    ...row,
    isLocal: Boolean(row.file_path),
    bookmarked: Boolean(row.bookmarked),
    fileExists: Boolean(row.file_path)
  };
}

async function androidListVideos(options = {}) {
  const db = await getAndroidDb();

  const {
    type = 'all',
    channelId = '',
    query = '',
    bookmarkedOnly = false
  } = options || {};

  let sql = `
    SELECT v.*,
      EXISTS (
        SELECT 1 FROM bookmarks b WHERE b.video_id = v.id
      ) AS bookmarked
    FROM videos v
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
        SELECT 1 FROM bookmarks b WHERE b.video_id = v.id
      )
    `;
  }

  if (query && String(query).trim()) {
    sql += `
      AND (
        v.title LIKE ? OR
        v.channel_title LIKE ? OR
        v.tags LIKE ? OR
        v.description LIKE ?
      )
    `;

    const term = `%${String(query).trim()}%`;
    values.push(term, term, term, term);
  }

  sql += ' ORDER BY v.created_at DESC, v.id DESC LIMIT 1000';

  const result = await db.query(sql, values);
  return (result.values || []).map(mapVideo);
}

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

async function androidToggleBookmark(id) {
  const db = await getAndroidDb();

  const existing = await db.query(
    'SELECT id FROM bookmarks WHERE video_id = ?',
    [Number(id)]
  );

  if (existing.values?.length) {
    await db.run(
      'DELETE FROM bookmarks WHERE video_id = ?',
      [Number(id)]
    );
  } else {
    await db.run(
      'INSERT OR IGNORE INTO bookmarks(video_id) VALUES(?)',
      [Number(id)]
    );
  }

  return androidListVideos();
}

async function androidUpdateTags({ id, tags }) {
  const db = await getAndroidDb();

  await db.run(
    'UPDATE videos SET tags = ? WHERE id = ?',
    [String(tags || '').slice(0, 1000), Number(id)]
  );

  return androidListVideos();
}

async function androidLoadNotesPath(videoId) {
  return `localtube-note://${Number(videoId)}`;
}

async function androidReadNotes(notePath) {
  const match = String(notePath).match(/^localtube-note:\/\/(\d+)$/);

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

  await db.run(`
    INSERT INTO video_notes(video_id, content, updated_at)
    VALUES(?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(video_id)
    DO UPDATE SET
      content = excluded.content,
      updated_at = CURRENT_TIMESTAMP
  `, [Number(videoId), String(content || '')]);

  return {
    canceled: false,
    filePath: `localtube-note://${Number(videoId)}`
  };
}

async function androidImportFiles() {
  const db = await getAndroidDb();

  const pickerResult = await FilePicker.pickVideos({
    limit: 0
  });

  const files = pickerResult?.files || [];

  if (!files.length) {
    return { addedCount: 0 };
  }

  let addedCount = 0;
  const errors = [];

  for (const file of files) {
    try {
      if (!file.path) {
        throw new Error(`No accessible file URI for ${file.name}`);
      }

      const originalName = file.name || 'video';
      const title = originalName.replace(/\.[^/.]+$/, '') || 'Untitled video';

      // Copy the video into LocalTube's private Android storage.
      const copied = await LocalMedia.copyVideo({
        uri: file.path,
        fileName: originalName
      });

      if (!copied?.path) {
        throw new Error('Android did not return the copied video path.');
      }

      // Save the copied file's metadata in the Android database.
      await db.run(
        `INSERT INTO videos (
          title,
          channel_title,
          channel_id,
          youtube_id,
          youtube_url,
          file_path,
          thumbnail_url,
          description,
          tags
        ) VALUES (?, '', '', '', '', ?, '', '', '')`,
        [title, copied.path]
      );

      addedCount++;
    } catch (error) {
      console.error('[LocalTube] Failed to import video:', file.name, error);
      errors.push(`${file.name || 'Video'}: ${error.message || error}`);
    }
  }

  return {
    addedCount,
    errors
  };
}

async function androidOpenPlayer(videoId) {
  const db = await getAndroidDb();

  const result = await db.query(
    `SELECT id, title, file_path, youtube_id
     FROM videos
     WHERE id = ?
     LIMIT 1`,
    [Number(videoId)]
  );

  const video = result.values?.[0];

  if (!video) {
    throw new Error('Video not found in your LocalTube library.');
  }

  if (!video.file_path) {
    if (video.youtube_id) {
      throw new Error(
        'This is a YouTube video. YouTube playback will be connected in the next phase.'
      );
    }

    throw new Error('This video does not have a local file.');
  }

  return LocalPlayer.play({
    path: video.file_path,
    title: video.title || 'LocalTube'
  });
}

function unavailable(feature) {
  return async () => {
    throw new Error(`${feature} is not connected yet. It will be added in the next Android development step.`);
  };
}

function createAndroidApi() {
  return {
    listVideos: androidListVideos,
    listChannels: androidListChannels,
    toggleBookmark: androidToggleBookmark,
    updateTags: androidUpdateTags,
    loadNotesPath: androidLoadNotesPath,
    readNotes: androidReadNotes,
    saveNotes: androidSaveNotes,
    importFiles: androidImportFiles,
    fetchChannel: unavailable('Android YouTube channel import'),
    openPlayer: androidOpenPlayer,
    getVideoUrl: unavailable('Android video playback'),
    getDataPath: async () => 'LocalTube Android private database'
  };
}

export function createPlatformApi() {
  // Electron takes priority because Capacitor reports "web"
  // when running inside the Electron renderer.
  if (window.localTube) {
    return window.localTube;
  }

  if (Capacitor.getPlatform() === 'android') {
    return createAndroidApi();
  }

  // Browser preview: fail clearly instead of producing
  // "Cannot read properties of undefined".
  return {
    listVideos: unavailable('Browser database preview'),
    listChannels: unavailable('Browser database preview'),
    toggleBookmark: unavailable('Browser database preview'),
    updateTags: unavailable('Browser database preview'),
    loadNotesPath: unavailable('Browser database preview'),
    readNotes: unavailable('Browser database preview'),
    saveNotes: unavailable('Browser database preview'),
    importFiles: unavailable('Browser file picker'),
    fetchChannel: unavailable('Browser channel import'),
    openPlayer: unavailable('Browser video player'),
    getVideoUrl: unavailable('Browser video playback'),
    getDataPath: unavailable('Browser database')
  };
}
