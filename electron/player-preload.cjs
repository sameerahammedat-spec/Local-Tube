const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localTubePlayer', {
  saveProgress: (payload) => {
    ipcRenderer.send('player:progress', payload);
  },

  reportTime: (payload) => {
    ipcRenderer.send('player:time', payload);
  }
});