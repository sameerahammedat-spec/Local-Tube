const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const Database = require('better-sqlite3');
const { normalizeProgressPayload, getSafeResumePosition } = require('./playback-progress.cjs');

const dataDir = path.join(app.getPath('userData'), 'LocalTube');

let db;
let mainWindow;

function getDb() {
  if (db) return db;

  
  fs.mkdirSync(dataDir, { recursive: true });

  db = new Database(path.join(dataDir, 'localtube.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
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
    ON videos(file_path) WHERE file_path IS NOT NULL AND file_path != '';

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

    CREATE TABLE IF NOT EXISTS watch_history (
      video_id INTEGER PRIMARY KEY,
      position_seconds REAL NOT NULL DEFAULT 0,
      duration_seconds REAL NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0,
      last_watched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS watch_history_recent
    ON watch_history(last_watched_at DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS video_search
    USING fts5(
      title, channel_title, description, tags,
      content='videos', content_rowid='id'
    );

    CREATE TRIGGER IF NOT EXISTS videos_ai
    AFTER INSERT ON videos BEGIN
      INSERT INTO video_search(
        rowid, title, channel_title, description, tags
      )
      VALUES(
        new.id, new.title, new.channel_title,
        new.description, new.tags
      );
    END;

    CREATE TRIGGER IF NOT EXISTS videos_ad
    AFTER DELETE ON videos BEGIN
      INSERT INTO video_search(
        video_search, rowid, title, channel_title, description, tags
      )
      VALUES(
        'delete', old.id, old.title, old.channel_title,
        old.description, old.tags
      );
    END;

    CREATE TRIGGER IF NOT EXISTS videos_au
    AFTER UPDATE ON videos BEGIN
      INSERT INTO video_search(
        video_search, rowid, title, channel_title, description, tags
      )
      VALUES(
        'delete', old.id, old.title, old.channel_title,
        old.description, old.tags
      );

      INSERT INTO video_search(
        rowid, title, channel_title, description, tags
      )
      VALUES(
        new.id, new.title, new.channel_title,
        new.description, new.tags
      );
    END;
  `);

// Rebuild the FTS index once when the app starts.
// This indexes existing videos without deleting them.
db.exec(`INSERT INTO video_search(video_search) VALUES('rebuild');`);

  return db;
}

function mapVideo(row) {
  return {
    ...row,
    isLocal: Boolean(row.file_path),
    bookmarked: Boolean(row.bookmarked),
    fileExists: Boolean(row.file_path && fs.existsSync(row.file_path))
  };
}

// Accepts either an options object or the older (query, bookmarkedOnly) arguments.
function listVideos(options = {}, oldBookmarkedOnly = false) {
  if (typeof options === 'string') {
    options = {
      query: options,
      bookmarkedOnly: oldBookmarkedOnly
    };
  }

  const {
    type = 'all',
    channelId = '',
    query = '',
    bookmarkedOnly = false
  } = options || {};

  const database = getDb();

  let sql = `
    SELECT v.*,
      EXISTS(
        SELECT 1 FROM bookmarks b WHERE b.video_id = v.id
      ) AS bookmarked
    FROM videos v
    WHERE 1 = 1
  `;

  const params = [];

  if (type === 'local') {
    sql += ` AND v.file_path <> ''`;
  } else if (type === 'youtube') {
    sql += ` AND v.youtube_id <> '' AND v.file_path = ''`;
  }

  if (channelId) {
    sql += ` AND v.channel_id = ?`;
    params.push(String(channelId));
  }

  if (bookmarkedOnly) {
    sql += ` AND EXISTS (
      SELECT 1 FROM bookmarks b WHERE b.video_id = v.id
    )`;
  }

  if (query && String(query).trim()) {
  const searchText = String(query).trim();

  // Convert ordinary words into a safe FTS5 AND query.
  // This avoids treating user input as FTS operators.
  const terms = searchText
    .split(/\s+/)
    .map(term => term.replace(/["*():^{}]/g, ''))
    .filter(Boolean);

  if (terms.length) {
    const ftsQuery = terms
      .map(term => `"${term.replace(/"/g, '""')}"`)
      .join(' AND ');

    sql += `
      AND v.id IN (
        SELECT rowid
        FROM video_search
        WHERE video_search MATCH ?
      )
    `;

    params.push(ftsQuery);
  }
}

  sql += ` ORDER BY v.created_at DESC, v.id DESC LIMIT 1000`;

  return database.prepare(sql).all(...params).map(mapVideo);
}

function listChannels() {
  return getDb().prepare(`
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
  `).all();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1450,
    height: 920,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: '#101216',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: 'deny'
  }));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Register IPC handlers before the renderer starts calling them.

// List videos.
ipcMain.handle('library:list', (_event, options = {}) => {
  return listVideos(options);
});

// Get recently watched videos.
ipcMain.handle('history:list', (_event, limit = 20) => {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));

  return getDb().prepare(`
    SELECT v.*,
      EXISTS(
        SELECT 1 FROM bookmarks b WHERE b.video_id = v.id
      ) AS bookmarked,
      h.position_seconds,
      h.duration_seconds,
      h.completed,
      h.last_watched_at
    FROM watch_history h
    JOIN videos v ON v.id = h.video_id
    WHERE h.completed = 0
      AND h.position_seconds > 0
    ORDER BY h.last_watched_at DESC
    LIMIT ?
  `).all(safeLimit).map(mapVideo);
});

// Save playback progress reported by the player window.
ipcMain.on('player:progress', (_event, payload = {}) => {
  try {
    const progress = normalizeProgressPayload(payload);
    if (!progress) return;

    const { videoId, positionSeconds: position, durationSeconds: duration, completed } = progress;

    const exists = getDb().prepare(
      'SELECT id FROM videos WHERE id = ?'
    ).get(videoId);

    if (!exists) return;

    getDb().prepare(`
      INSERT INTO watch_history(
        video_id, position_seconds, duration_seconds,
        completed, last_watched_at
      )
      VALUES(?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(video_id) DO UPDATE SET
        position_seconds = excluded.position_seconds,
        duration_seconds = excluded.duration_seconds,
        completed = excluded.completed,
        last_watched_at = CURRENT_TIMESTAMP
    `).run(videoId, position, duration, completed);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('history:updated');
    }
  } catch (error) {
    console.error('[LocalTube] Could not save playback progress:', error);
  }
});

ipcMain.on('player:time', (_event, payload = {}) => {
  try {
    const videoId = Number(payload.videoId);
    const positionSeconds = Math.max(
      0,
      Number(payload.positionSeconds) || 0
    );


if (!Number.isInteger(videoId) || videoId <= 0) return;

if (!getDb().prepare(
'SELECT id FROM videos WHERE id = ?'
).get(videoId)) {
return;
}

if (mainWindow && !mainWindow.isDestroyed()) {
mainWindow.webContents.send('player:time', {
videoId,
positionSeconds
});
}
} catch (error) {
console.error('[LocalTube] Timestamp event failed:', error);
}
});
// List imported YouTube channels.
ipcMain.handle('channels:list', () => {
  return listChannels();
});

// Import local video files.
ipcMain.handle('library:importFiles', async () => {
  if (!mainWindow) {
    throw new Error('LocalTube window is not available.');
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import local videos',
    properties: ['openFile', 'multiSelections'],
    filters: [{
      name: 'Video files',
      extensions: [
        'mp4', 'webm', 'mkv', 'mov',
        'm4v', 'avi', 'ogv'
      ]
    }]
  });

  if (result.canceled || !result.filePaths?.length) {
    return {
      addedCount: 0,
      videos: listVideos({ type: 'local' })
    };
  }

  const database = getDb();

  const findExisting = database.prepare(
    'SELECT id FROM videos WHERE file_path = ?'
  );

  const insert = database.prepare(`
    INSERT INTO videos(title, file_path, channel_title, tags)
    VALUES(?, ?, 'Local videos', '')
  `);

  const transaction = database.transaction((selectedPaths) => {
    let added = 0;

    for (const selectedPath of selectedPaths) {
      const filePath = path.resolve(selectedPath);

      if (!fs.existsSync(filePath)) continue;
      if (findExisting.get(filePath)) continue;

      const title = path.basename(
        filePath,
        path.extname(filePath)
      ).replace(/[._-]+/g, ' ');

      insert.run(title, filePath);
      added++;
    }

    return added;
  });

  const addedCount = transaction(result.filePaths);

  return {
    addedCount,
    videos: listVideos({ type: 'local' })
  };
});

// Import YouTube catalogue records.
ipcMain.handle('library:addYouTubeItems', (_event, items) => {
  const database = getDb();

  const findExisting = database.prepare(
    'SELECT id FROM videos WHERE youtube_id = ?'
  );

  const insert = database.prepare(`
    INSERT INTO videos(
      title, channel_title, channel_id,
      youtube_id, youtube_url, thumbnail_url,
      description, tags
    )
    VALUES(
      @title, @channelTitle, @channelId,
      @youtubeId, @youtubeUrl, @thumbnailUrl,
      @description, ''
    )
  `);

  const transaction = database.transaction((rows) => {
    let added = 0;

    for (const item of rows) {
      const youtubeId = String(item?.youtubeId || '').trim();
      if (!/^[a-zA-Z0-9_-]{11}$/.test(youtubeId)) continue;
      if (findExisting.get(youtubeId)) continue;

      insert.run({
        title: String(item.title || 'Untitled').slice(0, 500),
        channelTitle: String(item.channelTitle || '').slice(0, 300),
        channelId: String(item.channelId || ''),
        youtubeId,
        youtubeUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
        thumbnailUrl: String(item.thumbnailUrl || ''),
        description: String(item.description || '').slice(0, 4000)
      });

      added++;
    }

    return added;
  });

  const addedCount = transaction(Array.isArray(items) ? items : []);

  return {
    addedCount,
    videos: listVideos({ type: 'youtube' })
  };
});

// Import a YouTube channel using YouTube Data API v3.
ipcMain.handle('channels:fetch', async (_event, payload = {}) => {
  const channelUrl = payload.channelUrl || '';
  const apiKey = payload.apiKey || '';

  if (!String(apiKey).trim()) {
    throw new Error('Enter your YouTube Data API v3 key first.');
  }

  const input = String(channelUrl).trim();

  if (!input) {
    throw new Error('Enter a YouTube channel URL or @handle.');
  }

  let channelId = '';
  let handle = '';

  const channelUrlMatch = input.match(
    /youtube\.com\/channel\/(UC[\w-]+)/i
  );

  const handleUrlMatch = input.match(
    /youtube\.com\/@([\w.-]+)/i
  );

  if (channelUrlMatch) {
    channelId = channelUrlMatch[1];
  } else if (handleUrlMatch) {
    handle = handleUrlMatch[1];
  } else if (/^UC[\w-]+$/.test(input)) {
    channelId = input;
  } else if (/^@?[\w.-]+$/.test(input)) {
    handle = input.replace(/^@/, '');
  } else {
    throw new Error(
      'Invalid channel input. Use a channel URL, @handle, or UC channel ID.'
    );
  }

  const baseUrl = 'https://www.googleapis.com/youtube/v3/';

  async function youtubeRequest(endpoint, params) {
    const url = new URL(endpoint, baseUrl);

    for (const [key, value] of Object.entries({
      ...params,
      key: String(apiKey).trim()
    })) {
      url.searchParams.set(key, String(value));
    }

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error?.message || `YouTube API error: ${response.status}`
      );
    }

    return data;
  }

  let channelData;

  if (handle) {
    channelData = await youtubeRequest('channels', {
      part: 'id,snippet,contentDetails',
      forHandle: handle
    });
  } else {
    channelData = await youtubeRequest('channels', {
      part: 'id,snippet,contentDetails',
      id: channelId
    });
  }

  const channel = channelData.items?.[0];

  if (!channel) {
    throw new Error(
      'Channel not found. Check the channel URL, handle, and API key.'
    );
  }

  const uploadsPlaylist =
    channel.contentDetails?.relatedPlaylists?.uploads;

  if (!uploadsPlaylist) {
    throw new Error('Could not find this channelâ€™s uploads playlist.');
  }

  const collected = [];
  let pageToken = '';

  // Import up to 250 recent uploads.
  for (let page = 0; page < 5; page++) {
    const pageParams = {
      part: 'snippet,contentDetails',
      playlistId: uploadsPlaylist,
      maxResults: 50
    };

    if (pageToken) {
      pageParams.pageToken = pageToken;
    }

    const pageData = await youtubeRequest(
      'playlistItems',
      pageParams
    );

    for (const entry of pageData.items || []) {
      const snippet = entry.snippet || {};

      const youtubeId =
        entry.contentDetails?.videoId ||
        snippet.resourceId?.videoId;

      if (!youtubeId) continue;

      collected.push({
        title: snippet.title || 'Untitled',
        channelTitle: channel.snippet?.title || '',
        channelId: channel.id,
        youtubeId,
        youtubeUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
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

  const database = getDb();

  const findExisting = database.prepare(
    'SELECT id FROM videos WHERE youtube_id = ?'
  );

  const insert = database.prepare(`
    INSERT INTO videos(
      title, channel_title, channel_id,
      youtube_id, youtube_url, thumbnail_url,
      description, tags
    )
    VALUES(
      @title, @channelTitle, @channelId,
      @youtubeId, @youtubeUrl, @thumbnailUrl,
      @description, ''
    )
  `);

  const transaction = database.transaction((rows) => {
    let added = 0;

    for (const item of rows) {
      if (findExisting.get(item.youtubeId)) continue;

      insert.run({
        title: item.title,
        channelTitle: item.channelTitle,
        channelId: item.channelId,
        youtubeId: item.youtubeId,
        youtubeUrl: item.youtubeUrl,
        thumbnailUrl: item.thumbnailUrl,
        description: item.description
      });

      added++;
    }

    return added;
  });

  const addedCount = transaction(collected);

  return {
    channelTitle: channel.snippet?.title || '',
    channelId: channel.id,
    addedCount,
    videos: listVideos({
      type: 'youtube',
      channelId: channel.id
    })
  };
});

// Return a safe file:// URL for a local video.
ipcMain.handle('app:getVideoUrl', (_event, videoId) => {
  const video = getDb().prepare(
    'SELECT file_path FROM videos WHERE id = ?'
  ).get(Number(videoId));

  if (!video?.file_path || !fs.existsSync(video.file_path)) {
    throw new Error(
      'Local video file not found. It may have been moved or deleted.'
    );
  }

  return pathToFileURL(video.file_path).href;
});

// Toggle bookmark.
ipcMain.handle('library:bookmark', (_event, id) => {
  const database = getDb();
  const videoId = Number(id);

  const exists = database.prepare(
    'SELECT id FROM bookmarks WHERE video_id = ?'
  ).get(videoId);

  if (exists) {
    database.prepare(
      'DELETE FROM bookmarks WHERE video_id = ?'
    ).run(videoId);
  } else {
    database.prepare(
      'INSERT OR IGNORE INTO bookmarks(video_id) VALUES(?)'
    ).run(videoId);
  }

  return listVideos({ type: 'all' });
});

// Update video tags.
ipcMain.handle('library:updateTags', (_event, payload = {}) => {
  const { id, tags } = payload;

  getDb().prepare(
    'UPDATE videos SET tags = ? WHERE id = ?'
  ).run(
    String(tags || '').slice(0, 1000),
    Number(id)
  );

  return listVideos({ type: 'all' });
});

// Save notes to a .txt file and remember the file path.
ipcMain.handle('notes:save', async (_event, payload = {}) => {
  const { videoId, title, content } = payload;

  const safeTitle = String(title || 'Video notes')
    .replace(/[<>:"/\\|?*]/g, '_');

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save video notes',
    defaultPath: `${safeTitle}.txt`,
    filters: [{
      name: 'Text files',
      extensions: ['txt']
    }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  fs.writeFileSync(
    result.filePath,
    String(content || ''),
    'utf8'
  );

  getDb().prepare(`
    INSERT INTO settings(key, value)
    VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(
    `notes:${Number(videoId)}`,
    result.filePath
  );

  return {
    canceled: false,
    filePath: result.filePath
  };
});

// Load saved notes path.
ipcMain.handle('notes:loadPath', (_event, videoId) => {
  return getDb().prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).get(`notes:${Number(videoId)}`)?.value || '';
});

// Read notes file.
ipcMain.handle('notes:read', (_event, filePath) => {
  const requestedPath = String(filePath || '');
  if (!requestedPath) return '';

  // Only read note files previously selected through LocalTube's Save dialog.
  // The renderer cannot use this bridge to read arbitrary files on the PC.
  const allowed = getDb().prepare(
    "SELECT value FROM settings WHERE key LIKE 'notes:%'"
  ).all().some(row => path.resolve(row.value) === path.resolve(requestedPath));

  if (!allowed) {
    throw new Error('This file is not a saved LocalTube notes file.');
  }

  try {
    return fs.readFileSync(requestedPath, 'utf8');
  } catch {
    return '';
  }
});

// Automatically save notes without opening a Save dialog.
ipcMain.handle('notes:autoSave', (_event, payload = {}) => {
  const videoId = Number(payload.videoId);
  const content = String(payload.content || '');

  if (!Number.isInteger(videoId) || videoId <= 0) {
    throw new Error('Invalid video ID.');
  }

  const database = getDb();

  const savedPath = database.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).get(`notes:${videoId}`)?.value || '';

  // Persist the recovery draft first so an unavailable or read-only TXT
  // destination can never prevent the user's latest notes from being saved.
  database.prepare(`
    INSERT INTO settings(key, value)
    VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(`notes-draft:${videoId}`, content);

  // Keep the exported TXT file in sync when its destination is still writable.
  if (savedPath && fs.existsSync(path.dirname(savedPath))) {
    try {
      fs.writeFileSync(savedPath, content, 'utf8');
    } catch (error) {
      console.warn('[LocalTube] Could not update exported notes file:', error);
    }
  }

  return {
    saved: true,
    filePath: savedPath
  };
});


// Load autosaved notes.
ipcMain.handle('notes:loadDraft', (_event, videoId) => {
  const id = Number(videoId);
  const database = getDb();

  const draft = database.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).get(`notes-draft:${id}`);

  if (draft) {
    return draft.value;
  }

  const savedPath = database.prepare(
    'SELECT value FROM settings WHERE key = ?'
  ).get(`notes:${id}`)?.value;

  if (savedPath) {
    try {
      return fs.readFileSync(savedPath, 'utf8');
    } catch {
      return '';
    }
  }

  return '';
});


// Read focus settings.
ipcMain.handle('settings:get', () => {
  const rows = getDb().prepare(
    'SELECT key, value FROM settings WHERE key LIKE ?'
  ).all('focus:%');


const result = {};

for (const row of rows) {
const key = row.key.replace('focus:', '');

try {
result[key] = JSON.parse(row.value);
} catch {
console.warn('[LocalTube] Invalid focus setting:', key);
}
}

return result;
});

// Save focus settings.
ipcMain.handle('settings:save', (_event, settings = {}) => {
  const allowedSettings = [
    'enabled',
    'hideYouTube',
    'hideRecommendations',
    'hideShorts'
  ];

  const save = getDb().prepare(`
    INSERT INTO settings(key, value)
    VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const transaction = getDb().transaction(() => {
    for (const key of allowedSettings) {
      if (Object.prototype.hasOwnProperty.call(settings, key) &&
          typeof settings[key] === 'boolean') {
        save.run(
          `focus:${key}`,
          JSON.stringify(settings[key])
        );
      }
    }
  });

  transaction();

  return { saved: true };
});

// External YouTube browsing is intentionally disabled in LocalTube.
// Keep this IPC handler so older renderer code does not crash, but never
// open a browser or navigate away from the LocalTube application.
ipcMain.handle('app:openExternal', async () => {
  console.log('[LocalTube Security] External YouTube navigation is disabled.');
  return { success: false, blocked: true };
});

// Get LocalTube data directory.
ipcMain.handle('app:getDataPath', () => {
  return path.join(app.getPath('userData'), 'LocalTube');
});



ipcMain.handle('player:open', async (_event, videoId) => {
  const database = getDb();

  const video = database
    .prepare('SELECT * FROM videos WHERE id = ?')
    .get(Number(videoId));

  if (!video) {
    throw new Error('Video not found in LocalTube library.');
  }

  const savedProgress = database.prepare(`
    SELECT position_seconds, duration_seconds, completed
    FROM watch_history
    WHERE video_id = ?
  `).get(Number(videoId));

  const resumeSeconds = getSafeResumePosition(savedProgress);

  // Determine the playback source before creating the player window.
  let playerType;
  let playerSource;

  if (video.file_path) {
    if (!fs.existsSync(video.file_path)) {
      throw new Error('Local video file does not exist.');
    }

    playerType = 'local';
    playerSource = pathToFileURL(video.file_path).href;
  } else if (video.youtube_id) {
    playerType = 'youtube';
    playerSource = String(video.youtube_id).trim();

    if (!/^[a-zA-Z0-9_-]{11}$/.test(playerSource)) {
      throw new Error('This catalogue entry has an invalid YouTube video ID.');
    }
  } else {
    throw new Error('This video has no playable source.');
  }

  console.log('[LocalTube] Opening player:', {
    videoId: Number(videoId),
    playerType,
    title: video.title
  });

  const playerWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#080a12',
    title: `LocalTube Player - ${video.title || 'Video'}`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'player-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  });

  // Do not allow links inside the embedded player to create new windows.
  playerWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[LocalTube Security] Blocked player pop-up:', url);
    return { action: 'deny' };
  });

  // The player page itself must never navigate to another page.
  playerWindow.webContents.on('will-navigate', (event, url) => {
    console.log('[LocalTube Security] Blocked player navigation:', url);
    event.preventDefault();
  });



  // Block redirects of the top-level LocalTube player page.
  playerWindow.webContents.on(
    'will-redirect',
    (event, url, _isInPlace, isMainFrame) => {
      if (isMainFrame) {
        console.log('[LocalTube Security] Blocked player redirect:', url);
        event.preventDefault();
      }
    }
  );

  // Supply a Referer for YouTube's embedded-player request (error 153).
  // Register this only once; repeated player launches must not stack listeners.
  if (playerType === 'youtube' && !globalThis.__localTubeRefererHandlerInstalled) {
    playerWindow.webContents.session.webRequest.onBeforeSendHeaders(
      {
        urls: [
          'https://www.youtube-nocookie.com/*',
          'https://www.youtube.com/*'
        ]
      },
      (details, callback) => {
        details.requestHeaders.Referer = 'http://localhost/';
        callback({ requestHeaders: details.requestHeaders });
      }
    );

    globalThis.__localTubeRefererHandlerInstalled = true;
  }

 playerWindow.on('closed', () => {
  console.log('[LocalTube] Player window closed.');

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history:updated');
  }
});

  try {
    await playerWindow.loadFile(
      path.join(__dirname, 'player.html'),
      {
        query: {
          type: playerType,
          src: playerSource,
          title: video.title || 'LocalTube Player',
          videoId: String(video.id),
          start: String(resumeSeconds)
        }
      }
    );
  } catch (error) {
    if (!playerWindow.isDestroyed()) {
      playerWindow.close();
    }
    throw error;
  }

  return { success: true };
});


// Start application.
app.whenReady().then(() => {
  getDb();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  console.error('LocalTube startup failed:', error);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (db) {
    db.close();
    db = null;
  }
});

