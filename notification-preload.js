const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notificationApi', {
  onPush: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('notification:push', handler);
    return () => ipcRenderer.removeListener('notification:push', handler);
  },
  notifyEmpty: () => ipcRenderer.send('notification:empty')
});
