
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
import { appendTimestamp, normalizeFocusSettings, filterVideosForFocus, shouldShowRecommendations } from './lib/playback-utils.mjs';

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
  const [notesReadyForVideo, setNotesReadyForVideo] = useState(null);
  const [tags, setTags] = useState('');
  const [message, setMessage] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [focusSettings, setFocusSettings] = useState({ enabled: true, hideYouTube: true, hideRecommendations: true, hideShorts: true });
  const [settingsReady, setSettingsReady] = useState(false);

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

  // Restore distraction controls. Desktop persists these in SQLite;
  // Android/browser fallback uses local preferences without changing the library DB.
  useEffect(() => {
    let alive = true;
    async function restoreFocusSettings() {
      try {
        let saved = {};
        if (typeof api.getFocusSettings === 'function') {
          saved = await api.getFocusSettings();
        } else {
          try { saved = JSON.parse(localStorage.getItem('lt_focus_settings') || '{}'); } catch { saved = {}; }
        }
        if (alive) {
          setFocusSettings(normalizeFocusSettings({ ...focusSettings, ...saved }));
          setSettingsReady(true);
        }
      } catch (error) {
        console.warn('[LocalTube] Focus settings restore failed:', error);
        if (alive) setSettingsReady(true);
      }
    }
    restoreFocusSettings();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (focusSettings.enabled && focusSettings.hideYouTube) {
      if (page === 'channels') {
        setPage('local');
        setActiveChannel('');
      }
      setSelected(current => current && !current.isLocal ? null : current);
    }
  }, [focusSettings.enabled, focusSettings.hideYouTube, page]);

  async function updateFocusSetting(key, value) {
    const next = { ...focusSettings, [key]: value };
    setFocusSettings(next);
    try {
      if (typeof api.saveFocusSettings === 'function') {
        await api.saveFocusSettings({ [key]: value });
      } else {
        localStorage.setItem('lt_focus_settings', JSON.stringify(next));
      }
      setMessage('Focus preferences saved.');
    } catch (error) {
      setMessage(`Could not save focus preferences: ${error.message || error}`);
    }
  }

  // Receive playback timestamps from the separate Electron player window.
  useEffect(() => {
    if (!selected || typeof api.onPlayerTime !== 'function') return undefined;

    const unsubscribe = api.onPlayerTime(payload => {
      if (Number(payload?.videoId) === Number(selected.id)) {
        setPlaybackTime(Math.max(0, Number(payload.positionSeconds) || 0));
      }
    });

    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [selected?.id]);

  // Refresh Continue Watching when the separate player closes or saves history.
  useEffect(() => {
    if (typeof api.onHistoryUpdated !== 'function') return undefined;

    const unsubscribe = api.onHistoryUpdated(() => {
      if (typeof api.getHistory === 'function') {
        api.getHistory(20).then(setHistory).catch(error => {
          console.warn('[LocalTube] History refresh failed:', error);
        });
      }
    });

    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, []);

  // Load notes and tags whenever the selected video changes.
  // Mark notes as ready only after the correct video's content has loaded;
  // this prevents the previous video's text being autosaved to a new video.
  useEffect(() => {
    let alive = true;
    setNotesReadyForVideo(null);

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

        let content = '';
        if (typeof api.loadNotesDraft === 'function') {
          content = await api.loadNotesDraft(selected.id);
        } else if (path) {
          content = await api.readNotes(path);
        }

        if (!alive) return;

        setNotes(content || '');
        setTags(selected.tags || '');
        setNotesReadyForVideo(selected.id);
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

  // Automatically persist edits after a short pause. Desktop writes its
  // recovery draft and any existing TXT file; Android writes to SQLite.
  useEffect(() => {
    if (!selected || notesReadyForVideo !== selected.id) return undefined;

    const videoId = selected.id;
    const title = selected.title;
    const content = notes;

    const timer = setTimeout(async () => {
      try {
        await persistNotesDraft(videoId, title, content);
      } catch (error) {
        console.error('[LocalTube] Notes autosave failed:', error);
        setMessage(`Notes autosave failed: ${error.message || error}`);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [selected?.id, selected?.title, notes, notesReadyForVideo]);

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

      const importSummary = `${result.addedCount} added, ${Number(result.skippedCount) || 0} skipped.`;
      const importErrors = Array.isArray(result.errors) && result.errors.length
        ? ` ${result.errors.length} file(s) failed: ${result.errors.slice(0, 3).join(' | ')}`
        : '';
      setMessage(`Import finished: ${importSummary}${importErrors}`);
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
      setSelected(current => current ? { ...current, tags } : current);

      setMessage('Tags saved successfully.');
      await refresh();
    } catch (error) {
      setMessage(`Could not save tags: ${error.message}`);
    }
  }

  async function persistNotesDraft(videoId, title, content) {
    const payload = { videoId, title, content };
    if (typeof api.autoSaveNotes === 'function') {
      return api.autoSaveNotes(payload);
    }
    return api.saveNotes(payload);
  }

  async function saveNotes() {
    if (!selected) return;

    try {
      const exportPayload = { videoId: selected.id, title: selected.title, content: notes };
      const result = typeof api.exportNotes === 'function'
        ? await api.exportNotes(exportPayload)
        : await api.saveNotes(exportPayload);

      if (!result.canceled) {
        setNotesPath(result.fileName || result.filePath);
        setMessage('Notes exported successfully.');
      }
    } catch (error) {
      setMessage(`Could not save notes: ${error.message}`);
    }
  }

  function addTimestamp() {
    if (!selected) return;

    const totalSeconds = Math.max(0, Math.floor(playbackTime));
    const timestamp = appendTimestamp('', totalSeconds).trim();
    setNotes(current => appendTimestamp(current, totalSeconds));
    setMessage(`Timestamp ${timestamp} inserted.`);
  }

  const selectedChannel = channels.find(
    channel => channel.channelId === activeChannel
  );

  const visibleVideos = filterVideosForFocus(videos, focusSettings);
  const visibleHistory = filterVideosForFocus(history, focusSettings);
  const visibleRecommendations = filterVideosForFocus(recommendations, focusSettings);
  const showRecommendations = shouldShowRecommendations(focusSettings);
  const featuredVideo = (showRecommendations ? visibleRecommendations[0] : null) || visibleHistory[0] || visibleVideos[0] || null;

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
          className={`nav-item ${page === 'home' ? 'active' : ''}`}
          onClick={() => {
            setPage('home');
            setActiveChannel('');
            setSelected(null);
            setBookmarksOnly(false);
          }}
        >
          <Home size={18} />
          Home
        </button>

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

        {!(focusSettings.enabled && focusSettings.hideYouTube) && (
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
        )}

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

        <button
          className={`nav-item ${page === 'focus' ? 'active' : ''}`}
          onClick={() => {
            setPage('focus');
            setActiveChannel('');
            setSelected(null);
            setBookmarksOnly(false);
          }}
        >
          <ShieldCheck size={18} />
          Focus
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

        {page === 'home' && (
          <section className="library-section mobile-home-page">
            <div
              className={`mobile-hero ${featuredVideo ? 'has-featured-video' : ''}`}
              style={featuredVideo?.thumbnail_url ? {
                backgroundImage: `linear-gradient(90deg,rgba(5,8,16,.98) 0%,rgba(5,8,16,.78) 46%,rgba(5,8,16,.2) 100%),linear-gradient(0deg,#080b12 0%,transparent 58%),url("${featuredVideo.thumbnail_url}")`
              } : undefined}
            >
              <div className="mobile-hero-copy">
                <span className="eyebrow">{featuredVideo ? 'FEATURED IN YOUR LIBRARY' : 'YOUR PERSONAL VIDEO SPACE'}</span>
                <h2>{featuredVideo ? featuredVideo.title : <>Less scrolling.<br />More meaningful watching.</>}</h2>
                <p>{featuredVideo ? (featuredVideo.channel_title || 'Continue from your personal collection') : 'Your own library, available whenever you need it.'}</p>
                <div className="hero-actions">
                  {featuredVideo && (
                    <button className="primary-btn" onClick={() => openVideo(featuredVideo)}>
                      <Play size={17} fill="currentColor" /> Play featured
                    </button>
                  )}
                  <button className="outline-btn" onClick={importLocalFiles}>
                    <Plus size={17} /> Add videos
                  </button>
                </div>
              </div>
            </div>

            <div className="section-head">
              <div>
                <h2>Continue watching</h2>
                <p>Pick up where you left off.</p>
              </div>
            </div>

            {visibleHistory.length > 0 ? (
              <VideoGrid videos={visibleHistory} selected={selected}
                onSelect={setSelected} onPlay={openVideo} />
            ) : (
              <p className="mobile-hint">Your recently watched videos will appear here.</p>
            )}

            {showRecommendations && (
              <>
                <div className="section-head mobile-shelf-heading">
                  <div>
                    <h2>Recommended from your library</h2>
                    <p>Suggestions from content you've already imported.</p>
                  </div>
                </div>

                {(visibleRecommendations.length ? visibleRecommendations : visibleVideos).length > 0 ? (
                  <VideoGrid
                    videos={(visibleRecommendations.length ? visibleRecommendations : visibleVideos).slice(0, 8)}
                    selected={selected}
                    onSelect={setSelected}
                    onPlay={openVideo}
                  />
                ) : (
                  <p className="mobile-hint">Import videos to build your collection.</p>
                )}
              </>
            )}

            <div className="section-head mobile-shelf-heading">
              <div>
                <h2>Recently added</h2>
                <p>Your latest local videos.</p>
              </div>
            </div>

            {videos.length > 0 ? (
              <VideoGrid videos={visibleVideos.slice(0, 8)} selected={selected}
                onSelect={setSelected} onPlay={openVideo} />
            ) : (
              <p className="mobile-hint">No videos have been imported yet.</p>
            )}
          </section>
        )}

        {page === 'focus' && (
          <section className="library-section focus-page">
            <div className="focus-banner">
              <span className="eyebrow">DISTRACTION-REDUCED MODE</span>
              <h2>Make time for what matters.</h2>
              <p>Choose a video from your own library. No public feed or Shorts discovery.</p>
            </div>

            <div className="section-head">
              <div>
                <h2>Your focus library</h2>
                <p>{visibleVideos.length} videos in your local catalogue.</p>
              </div>
            </div>

            {videos.length > 0 ? (
              <VideoGrid videos={visibleVideos} selected={selected}
                onSelect={setSelected} onPlay={openVideo} />
            ) : (
              <p className="mobile-hint">Import local videos to build your focus library.</p>
            )}

            {selected && (
              <div className="focus-selected">
                <strong>Selected for focus</strong>
                <span>{selected.title}</span>
                <button className="primary-btn" onClick={() => openVideo(selected)}>
                  <Play size={16} fill="currentColor" /> Play again
                </button>
              </div>
            )}
          </section>
        )}
        {page === 'channels' && !(focusSettings.enabled && focusSettings.hideYouTube) && (
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
                  videos={visibleVideos}
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
                videos={visibleVideos}
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
                  {window.localTube ? 'Saved on this PC' : 'Saved in LocalTube'}
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
                onBlur={() => {
                  if (selected && notesReadyForVideo === selected.id) {
                    persistNotesDraft(selected.id, selected.title, notes).catch(error => {
                      console.error('[LocalTube] Notes blur-save failed:', error);
                      setMessage(`Notes save failed: ${error.message || error}`);
                    });
                  }
                }}
                placeholder="Write notes and timestamps..."
              />

              <div className="notes-footer">
                <span>
                  {notesPath
                    ? (notesPath.startsWith('localtube-note://') ? 'Saved in app database' : notesPath.split(/[\\/]/).pop())
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
              Control recommendations and browsing distractions. Your original
              video files remain in their existing locations.
            </p>

            <div className="settings-group">
              <h3>Focus &amp; distraction controls</h3>
              {[
                ['enabled', 'Enable Focus defaults', 'Prioritise your local library.'],
                ['hideYouTube', 'Hide YouTube discovery', 'Keep channel catalogue access intentional.'],
                ['hideRecommendations', 'Hide recommendations', 'Reduce suggested-content shelves.'],
                ['hideShorts', 'Block Shorts and external navigation', 'Always enforced: the single-video player cannot open YouTube feeds or navigate away.']
              ].map(([key, label, description]) => (
                <label className="setting-row" key={key}>
                  <span><strong>{label}</strong><small>{description}</small></span>
                  <input
                    type="checkbox"
                    checked={key === 'hideShorts' ? true : Boolean(focusSettings[key])}
                    disabled={!settingsReady || key === 'hideShorts'}
                    onChange={event => updateFocusSetting(key, event.target.checked)}
                  />
                </label>
              ))}
            </div>

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
          } ${video.isLocal && video.fileExists === false ? 'unavailable' : ''}`}
          disabled={Boolean(video.isLocal && video.fileExists === false)}
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
              {video.isLocal && video.fileExists === false ? 'FILE MISSING' : video.isLocal ? 'LOCAL FILE' : 'YOUTUBE'}
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
