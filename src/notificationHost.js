const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

/** @type {BrowserWindow | null} */
let hostWindow = null;
let hostListenersReady = false;

/** @type {() => { theme: string, accent: string, bg: string, text: string, border: string }} */
let getAppearance = () => ({
  theme: 'Forest',
  accent: '0B8A5E',
  bg: 'EEF5F0',
  text: '0F1A15',
  border: 'C5D4CB'
});

function initNotificationHost(getAppearanceFn) {
  getAppearance = typeof getAppearanceFn === 'function' ? getAppearanceFn : getAppearance;

  if (hostListenersReady) return;
  hostListenersReady = true;

  ipcMain.on('notification:empty', () => {
    if (hostWindow && !hostWindow.isDestroyed()) {
      hostWindow.hide();
      hostWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  screen.on('display-metrics-changed', () => {
    if (hostWindow && !hostWindow.isDestroyed()) positionHostWindow(hostWindow);
  });
}

function positionHostWindow(win) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win.setBounds({
    x: Math.max(0, width - 404),
    y: Math.max(0, height - 520),
    width: 388,
    height: 504
  });
}

function ensureHostWindow() {
  if (hostWindow && !hostWindow.isDestroyed()) return hostWindow;

  hostWindow = new BrowserWindow({
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    show: false,
    hasShadow: false,
    thickFrame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'notification-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  positionHostWindow(hostWindow);
  hostWindow.loadFile(path.join(__dirname, '..', 'notification.html'));
  hostWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hostWindow.webContents.once('did-finish-load', () => {
    if (!hostWindow || hostWindow.isDestroyed()) return;
    hostWindow.setIgnoreMouseEvents(true, { forward: true });
  });

  hostWindow.on('closed', () => {
    hostWindow = null;
  });

  return hostWindow;
}

/**
 * @param {string} title
 * @param {string} body
 * @param {{ type?: 'success' | 'error' | 'warning' | 'info' }} [options]
 */
function showCustomNotification(title, body, options = {}) {
  const win = ensureHostWindow();
  const payload = {
    title: String(title || 'Macro'),
    body: String(body || ''),
    type: options.type || 'info',
    appearance: getAppearance(),
    appName: 'Macro'
  };

  const deliver = () => {
    if (!hostWindow || hostWindow.isDestroyed()) return;
    hostWindow.setIgnoreMouseEvents(false);
    hostWindow.webContents.send('notification:push', payload);
    if (!hostWindow.isVisible()) hostWindow.showInactive();
  };

  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', deliver);
  } else {
    deliver();
  }
}

function disposeNotificationHost() {
  if (hostWindow && !hostWindow.isDestroyed()) {
    try {
      hostWindow.setClosable(true);
      hostWindow.destroy();
    } catch {
      // ignore
    }
  }
  hostWindow = null;
}

module.exports = {
  initNotificationHost,
  showCustomNotification,
  disposeNotificationHost
};
