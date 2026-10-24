const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('localTube', {
  listVideos: args => ipcRenderer.invoke('library:list', args),
  importFiles: () => ipcRenderer.invoke('library:importFiles'),
  addYouTubeItems: items => ipcRenderer.invoke('library:addYouTubeItems', items),
  toggleBookmark: id => ipcRenderer.invoke('library:bookmark', id),
  updateTags: payload => ipcRenderer.invoke('library:updateTags', payload),
  saveNotes: payload => ipcRenderer.invoke('notes:save', payload),
  loadNotesPath: id => ipcRenderer.invoke('notes:loadPath', id),
  readNotes: path => ipcRenderer.invoke('notes:read', path),
  fetchChannel: payload => ipcRenderer.invoke('channels:fetch', payload),
  openLocalFile: path => ipcRenderer.invoke('app:openLocalFile', path),
  openExternal: url => ipcRenderer.invoke('app:openExternal', url),
  getDataPath: () => ipcRenderer.invoke('app:getDataPath')
});