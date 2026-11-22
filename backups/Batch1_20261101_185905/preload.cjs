
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localTube', {
  // Video library

  openPlayer: (videoId) =>
  ipcRenderer.invoke('player:open', videoId),
  
  listVideos: (options = {}) =>
    ipcRenderer.invoke('library:list', options),

  importFiles: () =>
    ipcRenderer.invoke('library:importFiles'),

  addYouTubeItems: (items) =>
    ipcRenderer.invoke('library:addYouTubeItems', items),

  toggleBookmark: (id) =>
    ipcRenderer.invoke('library:bookmark', id),

  updateTags: (payload) =>
    ipcRenderer.invoke('library:updateTags', payload),

  // YouTube channels
  listChannels: () =>
    ipcRenderer.invoke('channels:list'),

  fetchChannel: (payload) =>
    ipcRenderer.invoke('channels:fetch', payload),

  // Local video playback
  getVideoUrl: (videoId) =>
    ipcRenderer.invoke('app:getVideoUrl', videoId),

  // Notes
  saveNotes: (payload) =>
    ipcRenderer.invoke('notes:save', payload),

  loadNotesPath: (videoId) =>
    ipcRenderer.invoke('notes:loadPath', videoId),

  readNotes: (filePath) =>
    ipcRenderer.invoke('notes:read', filePath),

  // External links and app information
  openExternal: (url) =>
    ipcRenderer.invoke('app:openExternal', url),

  getDataPath: () =>
    ipcRenderer.invoke('app:getDataPath')
});
