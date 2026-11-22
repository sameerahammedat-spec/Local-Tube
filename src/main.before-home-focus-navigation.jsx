
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Bookmark,
  FolderOpen,
  Home,
  NotebookPen,
  Play,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Youtube,
  X,
  Download,
  Check
} from 'lucide-react';
import './style.css';

import { createPlatformApi } from './platform/index.js';

const api = createPlatformApi();

function App() {
  const [page, setPage] = useState(window.localTube ? 'local' : 'home');
  const [history, setHistory] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [videos, setVideos] = useState([]);
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState('');
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [bookmarksOnly, setBookmarksOnly] = useState(false);

  const [channelUrl, setChannelUrl] = useState('');
  const [apiKey, setApiKey] = useState(
    localStorage.getItem('lt_api_key') || ''
  );
  const [channelBusy, setChannelBusy] = useState(false);

  const [notes, setNotes] = useState('');
  const [notesPath, setNotesPath] = useState('');
  const [tags, setTags] = useState('');
  const [message, setMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  // Open a video in the dedicated LocalTube player window.
  async function openVideo(video) {
    if (!video) return;

    try {
      setSelected(video);
      setMessage(`Opening "${video.title}"...`);

      console.log('[LocalTube] Opening video:', {
        id: video.id,
        title: video.title,
        isLocal: video.isLocal,
        youtube_id: video.youtube_id,
        file_path: video.file_path
      });

      if (!api?.openPlayer) {
        throw new Error(
          'Player service is unavailable. Check electron/preload.cjs.'
        );
      }

      const result = await api.openPlayer(video.id);

      console.log('[LocalTube] Player response:', result);

      setMessage(`Player opened: ${video.title}`);
    } catch (error) {
      console.error('[LocalTube] Playback failed:', error);
      setMessage(`Playback failed: ${error.message || error}`);
    }
  }

  async function loadLocal() {
    const rows = await api.listVideos({
      type: 'local',
      query,
      bookmarkedOnly: bookmarksOnly
    });

    setVideos(rows);
    return rows;
  }

  async function loadChannels() {
    const rows = await api.listChannels();
    setChannels(rows);
    return rows;
  }

  async function loadChannelVideos(channelId = activeChannel) {
    if (!channelId) {
      setVideos([]);
      return [];
    }

    const rows = await api.listVideos({
      type: 'youtube',
      channelId,
      query,
      bookmarkedOnly: bookmarksOnly
    });

    setVideos(rows);
    return rows;
  }

  async function refresh() {
    if (page === 'local' || page === 'home' || page === 'focus') {
      await loadLocal();

      if (typeof api.getHistory === 'function') {
        try {
          setHistory(await api.getHistory(20));
        } catch (error) {
          console.warn('[LocalTube] History unavailable:', error);
        }
      }

      if (typeof api.getRecommendations === 'function') {
        try {
          setRecommendations(await api.getRecommendations(20));
        } catch (error) {
          console.warn('[LocalTube] Recommendations unavailable:', error);
        }
      }
    } else if (page === 'channels') {
      await loadChannels();

      if (activeChannel) {
        await loadChannelVideos(activeChannel);
      } else {
        setVideos([]);
      }
    } else if (page === 'bookmarks') {
      const rows = await api.listVideos({
        type: 'all',
        query,
        bookmarkedOnly: true
      });

      setVideos(rows);
    }
  }

  useEffect(() => {
    refresh().catch(error => {
      console.error('[LocalTube] Refresh failed:', error);
      setMessage(error.message);
    });
  }, [page, query, bookmarksOnly, activeChannel]);

  // Load notes and tags whenever the selected video changes.
  useEffect(() => {
    let alive = true;

    async function loadSelectedDetails() {
      if (!selected) {
        setNotes('');
        setNotesPath('');
        setTags('');
        return;
      }

      try {
        const path = await api.loadNotesPath(selected.id);
        if (!alive) return;

        setNotesPath(path || '');

        const content = path
          ? await api.readNotes(path)
          : '';

        if (!alive) return;

        setNotes(content || '');
        setTags(selected.tags || '');
      } catch (error) {
        if (alive) {
          console.error('[LocalTube] Notes loading failed:', error);
          setMessage(error.message);
        }
      }
    }

    loadSelectedDetails();

    return () => {
      alive = false;
    };
  }, [selected?.id]);

  async function importLocalFiles() {
    try {
      setMessage('Opening video file picker...');

      const result = await api.importFiles();

      if (!result || typeof result.addedCount !== 'number') {
        throw new Error('Unexpected response from local import service.');
      }

      setPage('local');
      setActiveChannel('');
      setSelected(null);

      const importedVideos = await api.listVideos({
        type: 'local',
        query,
        bookmarkedOnly: bookmarksOnly
      });

      setVideos(importedVideos);

      setMessage(
        result.addedCount > 0
          ? `Successfully imported ${result.addedCount} new video(s).`
          : 'No new videos imported. The files may already be in your library.'
      );
    } catch (error) {
      console.error('[LocalTube] Local import failed:', error);
      setMessage(`Import failed: ${error.message || error}`);
    }
  }

  async function importChannel(event) {
    event.preventDefault();

    if (channelBusy) return;

    setChannelBusy(true);
    setMessage('');

    try {
      localStorage.setItem('lt_api_key', apiKey);

      const result = await api.fetchChannel({
        channelUrl,
        apiKey
      });

      setActiveChannel(result.channelId);
      setPage('channels');
      setSelected(null);
      setChannelUrl('');

      await loadChannels();
      await loadChannelVideos(result.channelId);

      setMessage(
        `${result.addedCount} new videos added from ${result.channelTitle}.`
      );
    } catch (error) {
      console.error('[LocalTube] Channel import failed:', error);
      setMessage(error.message || 'Channel import failed.');
    } finally {
      setChannelBusy(false);
    }
  }

  async function selectChannel(channelId) {
    setActiveChannel(channelId);
    setSelected(null);

    try {
      const rows = await api.listVideos({
        type: 'youtube',
        channelId,
        query,
        bookmarkedOnly: bookmarksOnly
      });

      setVideos(rows);
    } catch (error) {
      console.error('[LocalTube] Channel loading failed:', error);
      setMessage(error.message);
    }
  }

  async function toggleBookmark(video) {
    try {
      await api.toggleBookmark(video.id);

      if (selected?.id === video.id) {
        setSelected(old => ({
          ...old,
          bookmarked: !old.bookmarked
        }));
      }

      await refresh();
    } catch (error) {
      setMessage(`Bookmark failed: ${error.message}`);
    }
  }

  async function saveTags() {
    if (!selected) return;

    try {
      await api.updateTags({
        id: selected.id,
        tags
      });

      setMessage('Tags saved successfully.');
      await refresh();
    } catch (error) {
      setMessage(`Could not save tags: ${error.message}`);
    }
  }

  async function saveNotes() {
    if (!selected) return;

    try {
      const result = await api.saveNotes({
        videoId: selected.id,
        title: selected.title,
        content: notes
      });

      if (!result.canceled) {
        setNotesPath(result.filePath);
        setMessage('Notes saved successfully.');
      }
    } catch (error) {
      setMessage(`Could not save notes: ${error.message}`);
    }
  }

  function addTimestamp() {
    // The player is in a separate window, so its current playback
    // position is not available in this renderer yet.
    setMessage(
      'Timestamp capture from the separate player will be connected in a later update.'
    );
  }

  const selectedChannel = channels.find(
    channel => channel.channelId === activeChannel
  );

  const localCount = useMemo(
    () => videos.filter(video => video.isLocal).length,
    [videos]
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Play size={19} fill="currentColor" />
          </div>
          <div>
            <strong>LocalTube</strong>
            <small>YOUR PERSONAL LIBRARY</small>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>

        <button
          className={`nav-item ${page === 'local' ? 'active' : ''}`}
          onClick={() => {
            setPage('local');
            setActiveChannel('');
            setSelected(null);
            setBookmarksOnly(false);
          }}
        >
          <Home size={18} />
          Local videos
        </button>

        <button
          className={`nav-item ${page === 'channels' ? 'active' : ''}`}
          onClick={() => {
            setPage('channels');
            setSelected(null);
            setBookmarksOnly(false);
          }}
        >
          <Youtube size={18} />
          YouTube channels
          <span>{channels.length}</span>
        </button>

        <button
          className={`nav-item ${page === 'bookmarks' ? 'active' : ''}`}
          onClick={() => {
            setPage('bookmarks');
            setSelected(null);
            setBookmarksOnly(true);
          }}
        >
          <Bookmark size={18} />
          Bookmarks
        </button>

        <div className="sidebar-bottom">
          <div className="privacy-card">
            <ShieldCheck size={20} />
            <strong>Local-first by design</strong>
            <p>
              Your local video library and notes stay on this laptop.
              YouTube catalogue entries are stored separately.
            </p>
          </div>

          <button
            className="nav-item"
            onClick={() => setShowSettings(true)}
          >
            <Settings size={18} />
            Settings
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <div className="eyebrow">PERSONAL VIDEO WORKSPACE</div>
            <h1>
              {page === 'home'
                ? 'Your personal video space'
                : page === 'focus'
                  ? 'Focus mode'
                  : page === 'local'
                    ? 'Local videos'
                    : page === 'channels'
                      ? 'YouTube channels'
                      : 'Bookmarks'}
            </h1>
          </div>

          <div className="top-actions">
            <div className="searchbox">
              <Search size={17} />

              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search this library..."
              />

              {query && (
                <button onClick={() => setQuery('')}>
                  <X size={15} />
                </button>
              )}
            </div>

            <button
              className="primary-btn"
              onClick={importLocalFiles}
            >
              <Plus size={17} />
              Import local files
            </button>
          </div>
        </header>

        {message && (
          <div className="message" role="status">
            {message}
            <button onClick={() => setMessage('')}>
              <X size={15} />
            </button>
          </div>
        )}

        {page === 'channels' && (
          <section className="channel-page">
            <form
              className="channel-form panel"
              onSubmit={importChannel}
            >
              <h2>Import a YouTube channel</h2>

              <label>Channel URL or @handle</label>
              <input
                value={channelUrl}
                onChange={event => setChannelUrl(event.target.value)}
                placeholder="https://www.youtube.com/@GoogleDevelopers"
                required
              />

              <label>YouTube Data API v3 key</label>
              <input
                type="password"
                value={apiKey}
                onChange={event => setApiKey(event.target.value)}
                placeholder="Your API key"
                required
              />

              <p className="hint">
                This imports public video catalogue information, not video
                files. Up to 250 recent uploads are checked per import.
              </p>

              <button
                className="primary-btn"
                disabled={channelBusy}
              >
                <Download size={17} />
                {channelBusy ? 'Importing channel...' : 'Import channel'}
              </button>
            </form>

            <div className="channel-layout">
              <section className="channel-list panel">
                <h3>Your channels</h3>

                {channels.length === 0 && (
                  <p className="hint">No channels imported yet.</p>
                )}

                {channels.map(channel => (
                  <button
                    key={channel.channelId}
                    className={`channel-row ${
                      activeChannel === channel.channelId ? 'active' : ''
                    }`}
                    onClick={() => selectChannel(channel.channelId)}
                  >
                    <Youtube size={18} />

                    <span>
                      <strong>{channel.channelTitle}</strong>
                      <small>
                        {channel.videoCount} catalogue videos
                      </small>
                    </span>
                  </button>
                ))}
              </section>

              <section className="channel-videos">
                <div className="section-head">
                  <div>
                    <h2>
                      {selectedChannel
                        ? selectedChannel.channelTitle
                        : 'Select a channel'}
                    </h2>

                    <p>
                      {selectedChannel
                        ? `${videos.length} videos in this channel`
                        : 'Your imported channel videos will appear here.'}
                    </p>
                  </div>
                </div>

                <VideoGrid
                  videos={videos}
                  selected={selected}
                  onSelect={setSelected}
                  onPlay={openVideo}
                />
              </section>
            </div>
          </section>
        )}

        {page === 'local' && (
          <section className="library-section">
            <div className="section-head">
              <div>
                <h2>Your local video files</h2>
                <p>
                  {videos.length} saved videos · {localCount} local files
                </p>
              </div>
            </div>

            {videos.length === 0 ? (
              <div className="empty-state">
                <FolderOpen size={32} />
                <h3>No local videos yet</h3>
                <p>
                  Import video files from your computer to build your library.
                </p>

                <button
                  className="primary-btn"
                  onClick={importLocalFiles}
                >
                  <Plus size={17} />
                  Import videos
                </button>
              </div>
            ) : (
              <VideoGrid
                videos={videos}
                selected={selected}
                onSelect={setSelected}
                onPlay={openVideo}
              />
            )}
          </section>
        )}

        {page === 'bookmarks' && (
          <section className="library-section">
            <div className="section-head">
              <div>
                <h2>Bookmarked videos</h2>
                <p>Your saved videos from both libraries.</p>
              </div>
            </div>

            <VideoGrid
              videos={videos}
              selected={selected}
              onSelect={setSelected}
              onPlay={openVideo}
            />
          </section>
        )}

        <aside className="detail-panel">
          {selected ? (
            <>
              <div className="player-heading">
                <div>
                  <span className="eyebrow">NOW SELECTED</span>
                  <h2>{selected.title}</h2>
                  <p>{selected.channel_title}</p>
                </div>

                <button
                  className={`icon-btn ${
                    selected.bookmarked ? 'bookmarked' : ''
                  }`}
                  onClick={() => toggleBookmark(selected)}
                  title="Toggle bookmark"
                >
                  <Bookmark
                    size={19}
                    fill={
                      selected.bookmarked ? 'currentColor' : 'none'
                    }
                  />
                </button>

                <button
                  className="primary-btn compact"
                  onClick={() => openVideo(selected)}
                >
                  <Play size={16} />
                  Open player
                </button>
              </div>

              <div className="player-frame">
                <div className="catalogue-placeholder">
                  <Play size={36} />

                  <strong>{selected.title}</strong>

                  <p>
                    {selected.isLocal
                      ? 'Local video'
                      : 'YouTube channel video'}
                    {' '}· Opens in the dedicated LocalTube player.
                  </p>
                </div>
              </div>

              <div className="detail-tabs">
                <span className="tab-active">
                  <NotebookPen size={15} />
                  Notes
                </span>

                <span className="local-indicator">
                  Saved on this PC
                </span>
              </div>

              <div className="notes-toolbar">
                <span>VIDEO NOTES</span>

                <button
                  className="subtle-btn small"
                  onClick={addTimestamp}
                >
                  + Timestamp
                </button>
              </div>

              <textarea
                className="notes-editor"
                value={notes}
                onChange={event => setNotes(event.target.value)}
                placeholder="Write notes and timestamps..."
              />

              <div className="notes-footer">
                <span>
                  {notesPath
                    ? notesPath.split(/[\\/]/).pop()
                    : 'Not saved yet'}
                </span>

                <button
                  className="primary-btn compact"
                  onClick={saveNotes}
                >
                  <Check size={16} />
                  Save TXT
                </button>
              </div>

              <div className="tag-editor">
                <label>Tags</label>

                <div>
                  <input
                    value={tags}
                    onChange={event => setTags(event.target.value)}
                    placeholder="java, learning, revision"
                  />

                  <button
                    className="subtle-btn small"
                    onClick={saveTags}
                  >
                    Save tags
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="detail-empty">
              <div className="empty-icon">
                <Play size={27} />
              </div>

              <h3>Select a video</h3>

              <p>
                Select a local video or a YouTube catalogue entry to play it
                and write notes.
              </p>
            </div>
          )}
        </aside>

        <footer className="statusbar">
          <span>
            <span className="green-dot" />
            LOCAL DATABASE CONNECTED
          </span>

          <span>SQLite · Separate local and channel libraries</span>
        </footer>
      </main>

      {showSettings && (
        <div
          className="modal-backdrop"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="modal panel"
            onClick={event => event.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Settings</h2>

              <button
                className="icon-btn"
                onClick={() => setShowSettings(false)}
              >
                <X size={18} />
              </button>
            </div>

            <p className="hint">
              LocalTube stores your catalogue database in your Windows
              application data folder. Your original video files are not
              copied or moved.
            </p>

            <button
              className="outline-btn"
              onClick={async () => {
                const path = await api.getDataPath();
                setMessage(`Database folder: ${path}`);
                setShowSettings(false);
              }}
            >
              Show database folder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function VideoGrid({ videos, selected, onSelect, onPlay }) {
  if (!videos.length) {
    return (
      <div className="empty-state">
        <p>No videos found in this section.</p>
      </div>
    );
  }

  return (
    <div className="video-grid">
      {videos.map(video => (
        <button
          key={video.id}
          type="button"
          className={`video-card ${
            selected?.id === video.id ? 'selected' : ''
          }`}
          onClick={() => {
            onSelect(video);
            onPlay(video);
          }}
          title={`Play ${video.title}`}
        >
          <div className="thumb">
            {video.thumbnail_url ? (
              <img
                src={video.thumbnail_url}
                alt=""
                loading="lazy"
              />
            ) : (
              <div className="thumb-placeholder">
                <Play size={27} />
              </div>
            )}

            <span
              className={`source-chip ${
                video.isLocal ? 'local' : 'online'
              }`}
            >
              {video.isLocal ? 'LOCAL FILE' : 'YOUTUBE'}
            </span>

            <span className="card-play-icon">
              <Play size={25} fill="currentColor" />
            </span>
          </div>

          <div className="video-card-copy">
            <strong>{video.title}</strong>
            <span>{video.channel_title || 'Local videos'}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
