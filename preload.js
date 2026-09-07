const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('macroSetup', {
  getStatus: () => ipcRenderer.invoke('setup:get-status'),
  install: () => ipcRenderer.invoke('setup:install'),
  onProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('setup:progress', handler);
    return () => ipcRenderer.removeListener('setup:progress', handler);
  }
});

contextBridge.exposeInMainWorld('macro', {
  getStatus: () => ipcRenderer.invoke('macro:get-status'),
  start: (settings) => ipcRenderer.invoke('macro:start', settings),
  stop: () => ipcRenderer.invoke('macro:stop'),
  toggle: (settings) => ipcRenderer.invoke('macro:toggle', settings),
  toggleAppraise: (settings) => ipcRenderer.invoke('macro:toggle-appraise', settings),
  fix: () => ipcRenderer.invoke('macro:fix'),
  setSettings: (settings) => ipcRenderer.invoke('macro:set-settings', settings),
  getHotkeys: () => ipcRenderer.invoke('macro:get-hotkeys'),
  setHotkey: (action, accelerator) => ipcRenderer.invoke('macro:set-hotkey', action, accelerator),
  getAppraiseSettings: () => ipcRenderer.invoke('macro:get-appraise-settings'),
  pickAppraisePoint: () => ipcRenderer.invoke('macro:pick-appraise-point'),
  clearAppraisePoint: () => ipcRenderer.invoke('macro:clear-appraise-point'),
  onStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('macro:status', handler);
    return () => ipcRenderer.removeListener('macro:status', handler);
  }
});

contextBridge.exposeInMainWorld('appearance', {
  get: () => ipcRenderer.invoke('appearance:get'),
  save: (payload) => ipcRenderer.invoke('appearance:save', payload)
});

contextBridge.exposeInMainWorld('preferences', {
  get: () => ipcRenderer.invoke('preferences:get'),
  save: (payload) => ipcRenderer.invoke('preferences:save', payload)
});
