/**
 * In-app updates via electron-updater + GitHub Releases (NSIS installs).
 * Users never need to open GitHub — Check / Update stays inside Macro.
 * AGPL-3.0-only — see NOTICE / LICENSE.
 */
'use strict';

const { app } = require('electron');

/** @type {import('electron-updater').AppUpdater | null} */
let autoUpdater = null;
/** @type {((payload: object) => void) | null} */
let progressSink = null;
let listenersReady = false;
/** @type {import('electron-updater').UpdateInfo | null} */
let lastUpdateInfo = null;
let updateDownloaded = false;

function getAutoUpdater() {
  if (autoUpdater) return autoUpdater;
  // Lazy-load so plain node scripts don't pull electron-updater hard.
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // Public GitHub repo — no token needed for checking/downloading releases.
  autoUpdater.allowPrerelease = false;
  return autoUpdater;
}

/**
 * @param {(payload: object) => void} [onEvent]
 */
function initAppUpdater(onEvent) {
  progressSink = typeof onEvent === 'function' ? onEvent : null;
  if (listenersReady) return;
  listenersReady = true;

  const updater = getAutoUpdater();

  updater.on('download-progress', (progress) => {
    emit({
      type: 'progress',
      percent: Number(progress.percent) || 0,
      transferred: Number(progress.transferred) || 0,
      total: Number(progress.total) || 0,
      bytesPerSecond: Number(progress.bytesPerSecond) || 0
    });
  });

  updater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    lastUpdateInfo = info;
    emit({
      type: 'downloaded',
      version: info.version,
      releaseName: info.releaseName || `Macro ${info.version}`,
      releaseNotes: normalizeNotes(info.releaseNotes)
    });
  });

  updater.on('error', (err) => {
    emit({
      type: 'error',
      message: friendlyUpdaterError(err)
    });
  });
}

function emit(payload) {
  if (progressSink) progressSink(payload);
}

function normalizeNotes(notes) {
  if (!notes) return '';
  if (typeof notes === 'string') return notes.trim();
  if (Array.isArray(notes)) {
    return notes
      .map((n) => (typeof n === 'string' ? n : n && n.note ? String(n.note) : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return String(notes).trim();
}

function friendlyUpdaterError(err) {
  const msg = String((err && err.message) || err || 'Update failed');
  if (/ZIP file|portable|app-update\.yml|latest\.yml/i.test(msg)) {
    return 'In-app updates need the installed Setup build (not the ZIP/portable). Reinstall Macro with the Setup installer.';
  }
  if (/ENOTFOUND|net::|timed out|network/i.test(msg)) {
    return 'Could not reach the update server. Check your internet and try again.';
  }
  if (/404|Not Found/i.test(msg)) {
    return 'No update package found yet. A Setup release may not be published.';
  }
  return msg;
}

/**
 * @returns {Promise<object>}
 */
async function checkForUpdates() {
  const currentVersion = app.getVersion();

  if (!app.isPackaged) {
    return {
      ok: true,
      updateAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      releaseName: '',
      releaseNotes: '',
      canApplyInApp: false,
      error: 'In-app updates work in the installed Macro app, not during npm start.'
    };
  }

  try {
    const updater = getAutoUpdater();
    updateDownloaded = false;
    const result = await updater.checkForUpdates();
    const info = result && result.updateInfo;
    if (!info || !info.version) {
      return {
        ok: false,
        updateAvailable: false,
        currentVersion,
        latestVersion: '',
        releaseName: '',
        releaseNotes: '',
        canApplyInApp: true,
        error: 'Could not read update information.'
      };
    }

    lastUpdateInfo = info;
    const latestVersion = String(info.version);
    const newer = isNewerVersion(latestVersion, currentVersion);

    return {
      ok: true,
      updateAvailable: newer,
      currentVersion,
      latestVersion,
      releaseName: info.releaseName || `Macro ${latestVersion}`,
      releaseNotes: normalizeNotes(info.releaseNotes),
      canApplyInApp: true
    };
  } catch (err) {
    return {
      ok: false,
      updateAvailable: false,
      currentVersion,
      latestVersion: '',
      releaseName: '',
      releaseNotes: '',
      canApplyInApp: app.isPackaged,
      error: friendlyUpdaterError(err)
    };
  }
}

function isNewerVersion(latest, current) {
  const parse = (v) =>
    String(v || '')
      .replace(/^v/i, '')
      .split(/[+-]/)[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

/**
 * Download the update package inside the app (no browser).
 * @returns {Promise<object>}
 */
async function downloadUpdate() {
  if (!app.isPackaged) {
    return { ok: false, error: 'Updates only work in the installed Macro app.' };
  }
  try {
    const updater = getAutoUpdater();
    updateDownloaded = false;
    emit({ type: 'progress', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
    await updater.downloadUpdate();
    updateDownloaded = true;
    return {
      ok: true,
      version: lastUpdateInfo && lastUpdateInfo.version,
      downloaded: true
    };
  } catch (err) {
    return { ok: false, error: friendlyUpdaterError(err) };
  }
}

/**
 * Quit and apply the downloaded update.
 * @returns {{ ok: boolean, error?: string }}
 */
function installUpdate() {
  if (!app.isPackaged) {
    return { ok: false, error: 'Updates only work in the installed Macro app.' };
  }
  if (!updateDownloaded) {
    return { ok: false, error: 'Download the update first.' };
  }
  try {
    // isSilent=false, isForceRunAfter=true — relaunch Macro after install
    getAutoUpdater().quitAndInstall(false, true);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyUpdaterError(err) };
  }
}

module.exports = {
  initAppUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  isNewerVersion
};
