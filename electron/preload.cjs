const { contextBridge, ipcRenderer } = require('electron');


function subscribe(channel, callback) {
if (typeof callback !== 'function') {
throw new TypeError('Callback must be a function.');
}

const listener = (_event, payload) => callback(payload);

ipcRenderer.on(channel, listener);

return () => {
ipcRenderer.removeListener(channel, listener);
};
}

contextBridge.exposeInMainWorld('localTube', {
// Library
openPlayer: videoId =>
ipcRenderer.invoke('player:open', videoId),

listVideos: (options = {}) =>
ipcRenderer.invoke('library:list', options),

getHistory: (limit = 20) =>
ipcRenderer.invoke('history:list', limit),

importFiles: () =>
ipcRenderer.invoke('library:importFiles'),

addYouTubeItems: items =>
ipcRenderer.invoke('library:addYouTubeItems', items),

toggleBookmark: id =>
ipcRenderer.invoke('library:bookmark', id),

updateTags: payload =>
ipcRenderer.invoke('library:updateTags', payload),

// Channels
listChannels: () =>
ipcRenderer.invoke('channels:list'),

fetchChannel: payload =>
ipcRenderer.invoke('channels:fetch', payload),

// Playback
getVideoUrl: videoId =>
ipcRenderer.invoke('app:getVideoUrl', videoId),

// Notes
saveNotes: payload =>
ipcRenderer.invoke('notes:save', payload),

loadNotesPath: videoId =>
ipcRenderer.invoke('notes:loadPath', videoId),

readNotes: filePath =>
ipcRenderer.invoke('notes:read', filePath),

autoSaveNotes: payload =>
ipcRenderer.invoke('notes:autoSave', payload),

loadNotesDraft: videoId =>
ipcRenderer.invoke('notes:loadDraft', videoId),

// Focus settings
getFocusSettings: () =>
ipcRenderer.invoke('settings:get'),

saveFocusSettings: settings =>
ipcRenderer.invoke('settings:save', settings),

// Events
onHistoryUpdated: callback =>
subscribe('history:updated', callback),

onPlayerTime: callback =>
subscribe('player:time', callback),

// App
openExternal: url =>
ipcRenderer.invoke('app:openExternal', url),

getDataPath: () =>
ipcRenderer.invoke('app:getDataPath')
});