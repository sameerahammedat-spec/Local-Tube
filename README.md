# LocalTube for Windows

LocalTube is a local-first Electron + React desktop app with SQLite catalogue/search, local video playback, bookmarks, tags, and plain-text notes.

## What works in this starter

- Imports video files from your laptop and plays them inside the app.
- Stores a local SQLite catalogue at Electron's per-user app-data path.
- Searches the local catalogue only (never performs YouTube search).
- Adds public video metadata from a YouTube channel using YouTube Data API v3.
- Bookmarks catalogue entries.
- Writes notes to `.txt` files using the Save TXT button and supports timestamp insertion.
- No homepage recommendations, Shorts feed, trending feed, or automatic external navigation.

## Important limitations

- A YouTube channel URL gives the app catalogue metadata, not the video file. This app does not bypass YouTube restrictions or download arbitrary YouTube streams. To watch offline, import a file you already have or obtain through an authorized download method.
- Channel import reads up to 250 recent uploads per run to keep quota use predictable.
- YouTube API key is saved in localStorage for this Windows user profile. For personal use, restrict it to YouTube Data API v3 in Google Cloud and don't publish/share it. For a hardened production release, move API-key management to an encrypted OS credential store and consider a backend proxy.
- The YouTube catalogue thumbnail uses an internet image URL and therefore requires connectivity to display.
- SQLite uses `better-sqlite3`, a native module. If install/build errors occur, use the troubleshooting steps below.

## Requirements

- Windows 10/11 64-bit
- Node.js LTS (20.x or 22.x) and npm
- Internet only for npm install and channel catalogue refresh

## Run in development

1. Install Node.js LTS from https://nodejs.org/
2. Extract this folder to a path such as `C:\LocalTube`.
3. Open PowerShell in that folder.
4. Run:

   ```powershell
   npm install
   npm run dev
   ```

5. The LocalTube desktop window should open.

## Build a Windows installer

```powershell
npm install
npm run dist
```

Installer output is created under `release\LocalTube-Setup-1.0.0.exe`. Run the installer to add LocalTube to Windows and create a desktop shortcut.

## YouTube Data API key setup

1. Open Google Cloud Console: https://console.cloud.google.com/
2. Create/select a project and enable **YouTube Data API v3**.
3. Create an API key under APIs & Services → Credentials.
4. Restrict the key to YouTube Data API v3.
5. In LocalTube, open Channel importer and paste the key plus a channel URL such as `https://www.youtube.com/@GoogleDevelopers`.
6. Click **Fetch channel catalogue**. It adds up to 250 recent uploads to the local catalogue.

The key is not a substitute for authentication or authorization to download content. Follow YouTube's terms and copyright rules.

## Usage

### Import local files
Click **Import files** and select one or more supported video files. Supported extensions include MP4, WebM, MKV, MOV, M4V, AVI, and OGV. Actual codec support depends on Chromium/Electron; MP4/H.264 is the safest starting point.

### Search
Type into the top search box. Results are from the local SQLite catalogue. Search does not query YouTube.

### Notes
Select a video, write notes in the right-hand panel, and click **Save TXT**. Use **+ Timestamp** while a local video is playing to insert its current playback time. Each Save TXT action lets you choose a location. The chosen path is remembered for display, but this starter does not silently overwrite the previous file; choose the same file in the save dialog if you want to replace it.

### Bookmarks and tags
Click the bookmark icon on the selected video. Add comma-separated tags at the bottom of the detail panel and click Save tags.

## Data location

Open Settings → Show data folder path. The SQLite database is inside that folder as `localtube.sqlite`. Back up this folder if your catalogue matters.

## Troubleshooting

### `better-sqlite3` native module error
Run in PowerShell:

```powershell
npm install
npx electron-builder install-app-deps
npm run dev
```

If the native module still fails, install the current Node.js LTS version and retry from a clean install:

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm install
npx electron-builder install-app-deps
```

### App opens but local video will not play
Try an MP4 encoded with H.264 video and AAC audio. Some codecs (including some MKV/AVI variants) may not be supported by Chromium.

### YouTube API error
Check the API key, enable YouTube Data API v3, confirm quota is available, and verify the channel URL. A channel URL may resolve differently from a custom channel name; a `/@handle` URL or `UC...` ID is recommended.
