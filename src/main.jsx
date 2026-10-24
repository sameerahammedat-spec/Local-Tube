import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bookmark, BookOpen, Check, Download, FolderOpen, Home, Library, Link2, ListVideo, LockKeyhole, NotebookPen, Play, Plus, Search, Settings, ShieldCheck, Youtube, X } from 'lucide-react';
import './style.css';

const api = window.localTube;
function App() {
  const [videos, setVideos] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState('library');
  const [bookmarksOnly, setBookmarksOnly] = useState(false);
  const [channelUrl, setChannelUrl] = useState('');
  const [apiKey, setApiKey] = useState(localStorage.getItem('lt_api_key') || '');
  const [channelBusy, setChannelBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState('');
  const [notesPath, setNotesPath] = useState('');
  const [tags, setTags] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  async function refresh() {
    const rows = await api.listVideos({ query, bookmarkedOnly });
    setVideos(rows);
    if (selected) {
      const current = rows.find(v => v.id === selected.id);
      if (current) setSelected(current);
    }
  }
  useEffect(() => { refresh(); }, [query, bookmarksOnly]);
  useEffect(() => {
    let alive = true;
    async function load() {
      if (!selected) { setNotes(''); setNotesPath(''); setTags(''); return; }
      const path = await api.loadNotesPath(selected.id);
      if (!alive) return;
      setNotesPath(path);
      setNotes(path ? await api.readNotes(path) : '');
      setTags(selected.tags || '');
    }
    load();
    return () => { alive = false; };
  }, [selected?.id]);

  const localCount = videos.filter(v => v.isLocal).length;
  const bookmarkCount = videos.filter(v => v.bookmarked).length;
  async function importFiles() {
    try { const rows = await api.importFiles(); setVideos(rows); setMessage('Local video files added to your library.'); }
    catch (e) { setMessage(e.message); }
  }
  async function fetchChannel(e) {
    e.preventDefault(); setChannelBusy(true); setMessage('');
    try {
      localStorage.setItem('lt_api_key', apiKey);
      const result = await api.fetchChannel({ channelUrl, apiKey });
      setVideos(result.videos); setSelected(null); setPage('library');
      setMessage(`Added ${result.importedCount} catalogue entries from ${result.channelTitle}.`);
      setChannelUrl('');
    } catch (e) { setMessage(e.message || 'Could not import channel.'); }
    finally { setChannelBusy(false); }
  }
  async function toggleBookmark(video) {
    const rows = await api.toggleBookmark(video.id); setVideos(rows);
    if (selected?.id === video.id) setSelected(rows.find(v => v.id === video.id) || { ...video, bookmarked: !video.bookmarked });
  }
  async function saveNotes() {
    if (!selected) return;
    const result = await api.saveNotes({ videoId: selected.id, title: selected.title, content: notes });
    if (!result.canceled) { setNotesPath(result.filePath); setMessage(`Notes saved: ${result.filePath}`); }
  }
  async function saveTags() {
    if (!selected) return;
    const rows = await api.updateTags({ id: selected.id, tags });
    setVideos(rows); setSelected(rows.find(v => v.id === selected.id) || selected);
    setMessage('Tags saved.');
  }
  function insertTimestamp() {
    const player = document.querySelector('video');
    const seconds = Math.floor(player?.currentTime || 0);
    const stamp = `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    setNotes(old => `${old}${old && !old.endsWith('\n') ? '\n' : ''}${stamp} — `);
  }
  const visibleVideos = videos;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Play size={19} fill="currentColor"/></div><div><strong>LocalTube</strong><small>YOUR PERSONAL LIBRARY</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <button className={`nav-item ${page==='library'?'active':''}`} onClick={()=>{setPage('library');setBookmarksOnly(false)}}><Home size={18}/> Library <span>{videos.length}</span></button>
      <button className={`nav-item ${bookmarksOnly?'active':''}`} onClick={()=>{setPage('library');setBookmarksOnly(true)}}><Bookmark size={18}/> Bookmarks <span>{bookmarkCount}</span></button>
      <button className={`nav-item ${page==='channels'?'active':''}`} onClick={()=>setPage('channels')}><Youtube size={18}/> Channel importer</button>
      <div className="sidebar-bottom">
        <div className="privacy-card"><ShieldCheck size={20}/><strong>Local-first by design</strong><p>Your library and notes stay on this laptop. Channel catalogue refreshes use the YouTube API.</p></div>
        <button className="nav-item" onClick={()=>setShowSettings(true)}><Settings size={18}/> Settings</button>
        <div className="sidebar-foot"><span className="green-dot"/> Distraction controls enabled</div>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar">
        <div><div className="eyebrow">PERSONAL VIDEO WORKSPACE</div><h1>{page==='channels'?'Channel importer':bookmarksOnly?'Your bookmarks':'Your library'}</h1></div>
        <div className="top-actions"><div className="searchbox"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your local catalogue..." aria-label="Search local catalogue"/>{query&&<button onClick={()=>setQuery('')}><X size={15}/></button>}</div><button className="primary-btn" onClick={importFiles}><Plus size={17}/> Import files</button></div>
      </header>
      {message && <div className="message" role="status">{message}<button onClick={()=>setMessage('')}><X size={15}/></button></div>}
      {page==='channels' ? <section className="channel-page">
        <div className="feature-banner"><div className="banner-icon"><Youtube size={27}/></div><div><h2>Add an approved YouTube channel</h2><p>Import a channel's public video catalogue into your local database. This does not download the video files.</p></div></div>
        <form className="channel-form panel" onSubmit={fetchChannel}>
          <label>Channel URL or channel ID</label><input value={channelUrl} onChange={e=>setChannelUrl(e.target.value)} placeholder="https://www.youtube.com/@GoogleDevelopers" required/>
          <label>YouTube Data API v3 key</label><input value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Paste your API key" required type="password"/>
          <p className="hint">The API key is saved in this Windows user profile's browser storage. Restrict it to the YouTube Data API in Google Cloud. The importer reads up to 250 recent uploads per refresh to limit API quota use.</p>
          <button className="primary-btn" disabled={channelBusy}>{channelBusy?'Fetching catalogue…':<><Download size={17}/> Fetch channel catalogue</>}</button>
        </form>
        <div className="panel info-panel"><LockKeyhole size={20}/><div><strong>Safe-by-default behaviour</strong><p>LocalTube does not embed a recommendation feed or allow YouTube search. YouTube entries are catalogue records only until you add a permitted local video file.</p></div></div>
      </section> : <div className="content-grid">
        <section className="library-section">
          <div className="section-head"><div><h2>{bookmarksOnly?'Bookmarked videos':'Video catalogue'}</h2><p>{videos.length} results · {localCount} local file{localCount===1?'':'s'} in current results</p></div><button className="subtle-btn" onClick={()=>setPage('channels')}><Link2 size={16}/> Add channel</button></div>
          {visibleVideos.length===0 ? <div className="empty-state"><div className="empty-icon"><Library size={29}/></div><h3>Your library starts here</h3><p>Import videos from your laptop or add a channel catalogue. Searches only look through your local database.</p><button className="primary-btn" onClick={importFiles}><FolderOpen size={17}/> Import local videos</button></div> : <div className="video-grid">
            {visibleVideos.map(video=><button key={video.id} className={`video-card ${selected?.id===video.id?'selected':''}`} onClick={()=>setSelected(video)}>
              <div className="thumb">{video.thumbnail_url ? <img src={video.thumbnail_url} alt="" loading="lazy"/> : <div className="thumb-placeholder"><Play size={27}/></div>}<span className={`source-chip ${video.isLocal?'local':'online'}`}>{video.isLocal?'LOCAL FILE':'CATALOGUE'}</span>{video.bookmarked&&<span className="bookmark-chip"><Bookmark size={13} fill="currentColor"/></span>}</div>
              <div className="video-card-copy"><strong>{video.title}</strong><span>{video.channel_title||'Local videos'}</span></div>
            </button>)}
          </div>}
        </section>
        <aside className="detail-panel">
          {selected ? <>
            <div className="player-heading"><div><span className="eyebrow">NOW SELECTED</span><h2>{selected.title}</h2><p>{selected.channel_title}</p></div><button className={`icon-btn ${selected.bookmarked?'bookmarked':''}`} title="Toggle bookmark" onClick={()=>toggleBookmark(selected)}><Bookmark size={19} fill={selected.bookmarked?'currentColor':'none'}/></button></div>
            <div className="player-frame">
              {selected.file_path ? <video key={selected.id} controls autoPlay src={`file://${selected.file_path.replace(/\\/g,'/')}`} /> : <div className="catalogue-placeholder"><Youtube size={35}/><strong>Catalogue entry only</strong><p>To watch offline, add a video file obtained through an authorized download method, then import it into LocalTube.</p><button className="outline-btn" onClick={importFiles}><FolderOpen size={16}/> Import a permitted video file</button><button className="text-btn" onClick={()=>api.openExternal(selected.youtube_url)}>Open this video on YouTube <Link2 size={14}/></button></div>}
            </div>
            <div className="detail-tabs"><span className="tab-active"><NotebookPen size={15}/> Notes</span><span className="local-indicator"><span className="green-dot"/> Saved locally as TXT</span></div>
            <div className="notes-toolbar"><span>VIDEO NOTES</span><button className="subtle-btn small" onClick={insertTimestamp}>+ Timestamp</button></div>
            <textarea className="notes-editor" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Capture key ideas, timestamps, and questions here…&#10;&#10;Your notes can be exported as a plain .txt file."/>
            <div className="notes-footer"><span>{notesPath?'Linked: '+notesPath.split(/[\\/]/).pop():'Not saved to a TXT file yet'}</span><button className="primary-btn compact" onClick={saveNotes}><Check size={16}/> Save TXT</button></div>
            <div className="tag-editor"><label>Tags (comma-separated)</label><div><input value={tags} onChange={e=>setTags(e.target.value)} placeholder="java, learning, revision"/><button className="subtle-btn small" onClick={saveTags}>Save tags</button></div></div>
          </> : <div className="detail-empty"><div className="empty-icon"><ListVideo size={27}/></div><h3>Select a video</h3><p>Choose a video from your catalogue to play a local file, bookmark it, or take notes beside the player.</p></div>}
        </aside>
      </div>}
      <footer className="statusbar"><span><span className="green-dot"/> LOCAL DATABASE CONNECTED</span><span>SQLite · Local search only · No recommendations</span></footer>
    </main>
    {showSettings&&<div className="modal-backdrop" onClick={()=>setShowSettings(false)}><div className="modal panel" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Settings & privacy</h2><button className="icon-btn" onClick={()=>setShowSettings(false)}><X size={18}/></button></div><div className="setting-row"><ShieldCheck size={20}/><div><strong>Distraction-reduction mode</strong><p>Enabled: no recommendation feed, Shorts feed, trending page, or unrestricted search in this app.</p></div></div><div className="setting-row"><BookOpen size={20}/><div><strong>Local database location</strong><p>Database and app data are stored in your Windows user profile's application data folder.</p></div></div><div className="setting-row"><LockKeyhole size={20}/><div><strong>API key</strong><p>The YouTube API key is stored locally for this Windows user. For personal use, restrict the key in Google Cloud and avoid sharing it.</p></div></div><button className="outline-btn" onClick={async()=>setMessage('App data folder: '+await api.getDataPath())}>Show data folder path</button></div></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
