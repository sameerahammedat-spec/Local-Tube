const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

let db;
let mainWindow;

function getDb() {
  if (db) return db;
  const dataDir = path.join(app.getPath('userData'), 'LocalTube');
  fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(path.join(dataDir, 'localtube.sqlite'));
  db.pragma('journal_mode = WAL');
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
    CREATE UNIQUE INDEX IF NOT EXISTS videos_unique_local_path ON videos(file_path) WHERE file_path <> '';
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
    CREATE VIRTUAL TABLE IF NOT EXISTS video_search USING fts5(title, channel_title, description, tags, content='videos', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS videos_ai AFTER INSERT ON videos BEGIN
      INSERT INTO video_search(rowid,title,channel_title,description,tags) VALUES(new.id,new.title,new.channel_title,new.description,new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS videos_ad AFTER DELETE ON videos BEGIN
      INSERT INTO video_search(video_search,rowid,title,channel_title,description,tags) VALUES('delete',old.id,old.title,old.channel_title,old.description,old.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS videos_au AFTER UPDATE ON videos BEGIN
      INSERT INTO video_search(video_search,rowid,title,channel_title,description,tags) VALUES('delete',old.id,old.title,old.channel_title,old.description,old.tags);
      INSERT INTO video_search(rowid,title,channel_title,description,tags) VALUES(new.id,new.title,new.channel_title,new.description,new.tags);
    END;
  `);
  return db;
}

function safeVideo(row) {
  return { ...row, bookmarked: Boolean(row.bookmarked), isLocal: Boolean(row.file_path) };
}
function listVideos(query = '', bookmarkedOnly = false) {
  const database = getDb();
  if (query.trim()) {
    const terms = query.trim().replace(/[^\p{L}\p{N}\s_-]/gu, ' ').split(/\s+/).filter(Boolean).map(x => `"${x.replaceAll('"','""')}"`).join(' AND ');
    if (!terms) return [];
    try {
      const rows = database.prepare(`
        SELECT v.*, EXISTS(SELECT 1 FROM bookmarks b WHERE b.video_id=v.id) AS bookmarked
        FROM video_search s JOIN videos v ON v.id=s.rowid
        WHERE video_search MATCH ? ${bookmarkedOnly ? 'AND EXISTS(SELECT 1 FROM bookmarks b WHERE b.video_id=v.id)' : ''}
        ORDER BY v.created_at DESC LIMIT 300
      `).all(terms);
      return rows.map(safeVideo);
    } catch { /* fall back to LIKE below */ }
  }
  const rows = database.prepare(`
    SELECT v.*, EXISTS(SELECT 1 FROM bookmarks b WHERE b.video_id=v.id) AS bookmarked
    FROM videos v
    WHERE (? = 0 OR EXISTS(SELECT 1 FROM bookmarks b WHERE b.video_id=v.id))
      AND (? = '' OR v.title LIKE ? OR v.channel_title LIKE ? OR v.tags LIKE ?)
    ORDER BY v.created_at DESC LIMIT 300
  `).all(bookmarkedOnly ? 1 : 0, query, `%${query}%`, `%${query}%`, `%${query}%`);
  return rows.map(safeVideo);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1450, height: 920, minWidth: 1000, minHeight: 680,
    backgroundColor: '#101216',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // No pop-up windows; external links are not opened automatically.
    return { action: 'deny' };
  });
}
app.whenReady().then(() => {
  getDb();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (db) db.close(); });

ipcMain.handle('library:list', (_e, args = {}) => listVideos(args.query || '', Boolean(args.bookmarkedOnly)));
ipcMain.handle('library:importFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import video files into LocalTube',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Video files', extensions: ['mp4','webm','mkv','mov','m4v','avi','ogv'] }]
  });
  if (result.canceled) return [];
  const insert = getDb().prepare(`INSERT OR IGNORE INTO videos(title,file_path,channel_title,tags) VALUES(?,?,?,?)`);
  const transaction = getDb().transaction(paths => paths.map(file => {
    const title = path.basename(file, path.extname(file)).replace(/[._-]+/g, ' ');
    insert.run(title, file, 'Local files', '');
    return getDb().prepare('SELECT * FROM videos WHERE file_path=?').get(file);
  }));
  transaction(result.filePaths);
  return listVideos();
});
ipcMain.handle('library:addYouTubeItems', (_e, items) => {
  const insert = getDb().prepare(`INSERT INTO videos(title,channel_title,channel_id,youtube_id,youtube_url,thumbnail_url,description,tags)
    VALUES(@title,@channelTitle,@channelId,@youtubeId,@youtubeUrl,@thumbnailUrl,@description,'')
    ON CONFLICT(file_path) DO NOTHING`);
  // file_path is empty for catalogue-only rows; avoid duplicate catalogue entries by checking YouTube ID.
  const exists = getDb().prepare('SELECT id FROM videos WHERE youtube_id=?');
  const add = getDb().transaction(rows => {
    for (const item of rows) {
      if (!item.youtubeId || exists.get(item.youtubeId)) continue;
      insert.run({ title: String(item.title || 'Untitled').slice(0,500), channelTitle: String(item.channelTitle || '').slice(0,300),
        channelId: String(item.channelId || ''), youtubeId: String(item.youtubeId), youtubeUrl: String(item.youtubeUrl || ''),
        thumbnailUrl: String(item.thumbnailUrl || ''), description: String(item.description || '').slice(0,4000) });
    }
  });
  add(Array.isArray(items) ? items : []);
  return listVideos();
});
ipcMain.handle('library:bookmark', (_e, id) => {
  const database = getDb();
  const exists = database.prepare('SELECT id FROM bookmarks WHERE video_id=?').get(Number(id));
  if (exists) database.prepare('DELETE FROM bookmarks WHERE video_id=?').run(Number(id));
  else database.prepare('INSERT OR IGNORE INTO bookmarks(video_id) VALUES(?)').run(Number(id));
  return listVideos();
});
ipcMain.handle('library:updateTags', (_e, { id, tags }) => {
  getDb().prepare('UPDATE videos SET tags=? WHERE id=?').run(String(tags || '').slice(0,1000), Number(id));
  return listVideos();
});
ipcMain.handle('notes:save', async (_e, { videoId, title, content }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save notes as text file',
    defaultPath: `${String(title || 'Video notes').replace(/[<>:"/\\\\|?*]/g,'_')}.txt`,
    filters: [{ name: 'Text files', extensions: ['txt'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, String(content || ''), 'utf8');
  getDb().prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(`notes:${Number(videoId)}`, result.filePath);
  return { canceled: false, filePath: result.filePath };
});
ipcMain.handle('notes:loadPath', (_e, videoId) => {
  return getDb().prepare('SELECT value FROM settings WHERE key=?').get(`notes:${Number(videoId)}`)?.value || '';
});
ipcMain.handle('notes:read', (_e, filePath) => {
  try { return fs.readFileSync(String(filePath), 'utf8'); } catch { return ''; }
});
ipcMain.handle('channels:fetch', async (_e, { channelUrl, apiKey }) => {
  if (!apiKey || !String(apiKey).trim()) throw new Error('Add a YouTube Data API v3 key in Settings first.');
  const input = String(channelUrl || '').trim();
  let channelId = '';
  let handle = '';
  const idMatch = input.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
  const handleMatch = input.match(/youtube\.com\/@([\w.-]+)/i);
  if (idMatch) channelId = idMatch[1];
  else if (handleMatch) handle = handleMatch[1];
  else if (/^UC[\w-]+$/.test(input)) channelId = input;
  else if (/^@?[\w.-]+$/.test(input)) handle = input.replace(/^@/,'');
  else throw new Error('Paste a channel URL such as https://www.youtube.com/@GoogleDevelopers or a UC... channel ID.');
  const base = 'https://www.googleapis.com/youtube/v3/';
  async function api(endpoint, params) {
    const url = new URL(base + endpoint);
    Object.entries({ ...params, key: apiKey }).forEach(([k,v]) => url.searchParams.set(k, v));
    const response = await fetch(url);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `YouTube API error (${response.status})`);
    return data;
  }
  let channel;
  if (handle) {
    const d = await api('channels', { part: 'id,snippet,contentDetails', forHandle: handle });
    channel = d.items?.[0];
  } else {
    const d = await api('channels', { part: 'id,snippet,contentDetails', id: channelId });
    channel = d.items?.[0];
  }
  if (!channel) throw new Error('Channel not found. Check the URL and API key.');
  const uploads = channel.contentDetails.relatedPlaylists.uploads;
  const all = [];
  let pageToken = '';
  // Keep API usage predictable; the user can refresh again later. YouTube API quota applies.
  for (let page = 0; page < 5; page++) {
    const pageData = await api('playlistItems', { part: 'snippet,contentDetails', playlistId: uploads, maxResults: 50, ...(pageToken ? { pageToken } : {}) });
    for (const entry of (pageData.items || [])) {
      const sn = entry.snippet || {};
      const vid = entry.contentDetails?.videoId || sn.resourceId?.videoId;
      if (!vid) continue;
      all.push({ title: sn.title || 'Untitled', channelTitle: channel.snippet.title, channelId: channel.id,
        youtubeId: vid, youtubeUrl: `https://www.youtube.com/watch?v=${vid}`,
        thumbnailUrl: sn.thumbnails?.medium?.url || sn.thumbnails?.default?.url || '',
        description: sn.description || '' });
    }
    pageToken = pageData.nextPageToken || '';
    if (!pageToken) break;
  }
  const insert = getDb().prepare(`INSERT INTO videos(title,channel_title,channel_id,youtube_id,youtube_url,thumbnail_url,description,tags)
    VALUES(@title,@channelTitle,@channelId,@youtubeId,@youtubeUrl,@thumbnailUrl,@description,'')`);
  const exists = getDb().prepare('SELECT id FROM videos WHERE youtube_id=?');
  const tx = getDb().transaction(rows => { for (const item of rows) if (!exists.get(item.youtubeId)) insert.run(item); });
  tx(all);
  return { channelTitle: channel.snippet.title, importedCount: all.length, videos: listVideos() };
});
ipcMain.handle('app:openLocalFile', async (_e, filePath) => {
  const resolved = String(filePath || '');
  if (!resolved || !fs.existsSync(resolved)) throw new Error('Local video file not found. It may have been moved.');
  return resolved;
});
ipcMain.handle('app:openExternal', async (_e, url) => {
  // Only allow explicit user action and YouTube watch URLs; no automatic navigation.
  if (!/^https:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/.test(String(url))) throw new Error('Only YouTube watch links are allowed.');
  await shell.openExternal(url);
  return true;
});
ipcMain.handle('app:getDataPath', () => path.join(app.getPath('userData'), 'LocalTube'));
