const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const requirements = require('./requirements');
const { MacroEngine, defaultSettings } = require('./src/engine');
const {
  DEFAULT_HOTKEYS,
  normalizeAccelerator,
  formatHotkeyLabel,
  readHotkeys,
  writeHotkeys
} = require('./src/hotkeys');
const {
  showDesktopNotification,
  handleStatusNotifications,
  notifyHotkeyChanged,
  setNotificationsEnabledGetter,
  resetStatusNotifications
} = require('./src/notifications');
const {
  initNotificationHost,
  disposeNotificationHost
} = require('./src/notificationHost');

app.commandLine.appendSwitch('disable-http-cache');

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {MacroEngine | null} */
let engine = null;

function setupStatePath() {
  return path.join(app.getPath('userData'), 'setup-state.json');
}

function readSetupState() {
  try {
    return JSON.parse(fs.readFileSync(setupStatePath(), 'utf8'));
  } catch {
    return { completed: false, completedAt: null, versions: {} };
  }
}

function writeSetupState(state) {
  fs.mkdirSync(path.dirname(setupStatePath()), { recursive: true });
  fs.writeFileSync(setupStatePath(), JSON.stringify(state, null, 2), 'utf8');
}

function packageInstalled(packageName) {
  try {
    require.resolve(packageName, { paths: [__dirname] });
    return true;
  } catch {
    return false;
  }
}

function packageLoads(packageName) {
  try {
    require(require.resolve(packageName, { paths: [__dirname] }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function isPackagedBuild() {
  return !!app.isPackaged;
}

function buildStatus() {
  const state = readSetupState();
  const platformOk = process.platform === requirements.platform;
  const items = requirements.packages.map((pkg) => {
    const installed = packageInstalled(pkg.name);
    const load = installed ? packageLoads(pkg.name) : { ok: false, error: 'Not installed' };
    return {
      id: pkg.id,
      name: pkg.name,
      label: pkg.label,
      description: pkg.description,
      installed,
      loadable: load.ok,
      error: load.ok ? null : load.error,
      status: !platformOk ? 'blocked' : load.ok ? 'ready' : installed ? 'broken' : 'missing'
    };
  });

  const packagesReady = items.every((item) => item.status === 'ready');

  if (packagesReady && platformOk && !state.completed) {
    const next = {
      completed: true,
      completedAt: new Date().toISOString(),
      versions: Object.fromEntries(items.map((i) => [i.name, 'ok']))
    };
    writeSetupState(next);
    state.completed = true;
    state.completedAt = next.completedAt;
  }

  if (state.completed && !packagesReady) {
    state.completed = false;
    writeSetupState(state);
  }

  // Packaged builds ship with deps; unpackaged still needs setup completed once.
  const ready = platformOk && packagesReady && (isPackagedBuild() || !!state.completed);

  return {
    ready,
    completed: !!state.completed && packagesReady && platformOk,
    packaged: isPackagedBuild(),
    platform: process.platform,
    platformOk,
    platformRequired: requirements.platform,
    items,
    projectDir: __dirname
  };
}

function sendProgress(payload) {
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('setup:progress', payload);
  }
}

function sendMacroStatus(payload) {
  handleStatusNotifications(payload);
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send('macro:status', payload);
  }
}

const DEFAULT_APPEARANCE = {
  theme: 'Forest',
  accent: '0B8A5E',
  bg: 'EEF5F0',
  text: '0F1A15',
  border: 'C5D4CB'
};

function appearancePath() {
  return path.join(app.getPath('userData'), 'appearance.json');
}

function readAppearance() {
  try {
    const raw = JSON.parse(fs.readFileSync(appearancePath(), 'utf8'));
    return {
      theme: raw.theme || DEFAULT_APPEARANCE.theme,
      accent: normalizeHexColor(raw.accent, DEFAULT_APPEARANCE.accent),
      bg: normalizeHexColor(raw.bg, DEFAULT_APPEARANCE.bg),
      text: normalizeHexColor(raw.text, DEFAULT_APPEARANCE.text),
      border: normalizeHexColor(raw.border, DEFAULT_APPEARANCE.border)
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

function normalizeHexColor(value, fallback) {
  const hex = String(value || '')
    .replace(/[^0-9a-fA-F]/g, '')
    .slice(0, 6)
    .toUpperCase();
  return hex.length === 6 ? hex : fallback;
}

function writeAppearance(partial) {
  const next = { ...readAppearance(), ...partial };
  next.accent = normalizeHexColor(next.accent, DEFAULT_APPEARANCE.accent);
  next.bg = normalizeHexColor(next.bg, DEFAULT_APPEARANCE.bg);
  next.text = normalizeHexColor(next.text, DEFAULT_APPEARANCE.text);
  next.border = normalizeHexColor(next.border, DEFAULT_APPEARANCE.border);
  fs.mkdirSync(path.dirname(appearancePath()), { recursive: true });
  fs.writeFileSync(appearancePath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function appearanceBackgroundColor(hex) {
  const normalized = normalizeHexColor(hex, DEFAULT_APPEARANCE.bg);
  return '#' + normalized.toLowerCase();
}

const DEFAULT_PREFERENCES = {
  notificationsEnabled: true,
  perfectCastEnabled: true,
  autoFixOffsets: true
};

function preferencesPath() {
  return path.join(app.getPath('userData'), 'preferences.json');
}

function readPreferences() {
  try {
    const raw = JSON.parse(fs.readFileSync(preferencesPath(), 'utf8'));
    return {
      notificationsEnabled: raw.notificationsEnabled !== false,
      perfectCastEnabled: raw.perfectCastEnabled !== false,
      autoFixOffsets: raw.autoFixOffsets !== false
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function writePreferences(partial) {
  const next = { ...readPreferences(), ...(partial || {}) };
  next.notificationsEnabled = next.notificationsEnabled !== false;
  next.perfectCastEnabled = next.perfectCastEnabled !== false;
  next.autoFixOffsets = next.autoFixOffsets !== false;
  fs.mkdirSync(path.dirname(preferencesPath()), { recursive: true });
  fs.writeFileSync(preferencesPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function runNpmInstall() {
  return new Promise((resolve, reject) => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npmCmd, ['install', '--no-fund', '--no-audit'], {
      cwd: __dirname,
      shell: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
    });

    let stderr = '';

    child.stdout.on('data', (buf) => {
      sendProgress({ type: 'log', line: buf.toString() });
    });

    child.stderr.on('data', (buf) => {
      const line = buf.toString();
      stderr += line;
      sendProgress({ type: 'log', line });
    });

    child.on('error', (err) => reject(err));

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `npm install exited with code ${code}`));
    });
  });
}

function getEngine() {
  if (!engine) {
    engine = new MacroEngine({
      onStatus: (status) => sendMacroStatus(status),
      isAutoFixEnabled: () => readPreferences().autoFixOffsets !== false
    });
  }
  return engine;
}

/** Stop fishing/appraise then reload the UI (main process engine survives otherwise). */
function reloadMacroUi() {
  if (engine) {
    try {
      engine.stop('OFF');
    } catch {
      // ignore
    }
  }
  resetStatusNotifications();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.reload();
  }
}

function ensureMacroAllowed() {
  const status = buildStatus();
  if (!status.ready) {
    return { ok: false, error: 'Finish requirements setup before using the macro.' };
  }
  return { ok: true };
}

function readUiSettingsFromPayload(payload) {
  const defaults = defaultSettings();
  if (!payload || typeof payload !== 'object') return defaults;
  return {
    ...defaults,
    update_rate: Number(payload.update_rate) || defaults.update_rate,
    prediction_strength: Number(payload.prediction_strength) || defaults.prediction_strength,
    neutral_duty_cycle: Number(payload.neutral_duty_cycle) || defaults.neutral_duty_cycle,
    close_threshold: Number(payload.close_threshold) || defaults.close_threshold,
    velocity_damping: Number(payload.velocity_damping) || defaults.velocity_damping,
    proportional_gain: Number(payload.proportional_gain) || defaults.proportional_gain,
    derivative_gain: Number(payload.derivative_gain) || defaults.derivative_gain,
    edge_boundary: Number(payload.edge_boundary) || defaults.edge_boundary,
    cast_mode: payload.cast_mode || defaults.cast_mode,
    cast_power_custom: Number(payload.cast_power_custom) || defaults.cast_power_custom,
    cast_timeout_ms: Number(payload.cast_timeout_ms) || defaults.cast_timeout_ms,
    post_cast_delay_ms: Number(payload.post_cast_delay_ms) || defaults.post_cast_delay_ms,
    cast_on_timeout: payload.cast_on_timeout !== false,
    completion_threshold: Number(payload.completion_threshold) || defaults.completion_threshold,
    shake_interval_ms: Number(payload.shake_interval_ms) || defaults.shake_interval_ms,
    lullaby_mode: payload.lullaby_mode || defaults.lullaby_mode,
    auto_appraise_enabled: !!payload.auto_appraise_enabled,
    auto_appraise_mutation: payload.auto_appraise_mutation || defaults.auto_appraise_mutation,
    appraise_delay_ms: Number(payload.appraise_delay_ms) || defaults.appraise_delay_ms,
    auto_appraise_click_x:
      payload.auto_appraise_click_x === '' || payload.auto_appraise_click_x == null
        ? ''
        : Number(payload.auto_appraise_click_x),
    auto_appraise_click_y:
      payload.auto_appraise_click_y === '' || payload.auto_appraise_click_y == null
        ? ''
        : Number(payload.auto_appraise_click_y)
  };
}

function appraiseStatePath() {
  return path.join(app.getPath('userData'), 'appraise-settings.json');
}

function readAppraiseSettings() {
  try {
    return JSON.parse(fs.readFileSync(appraiseStatePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeAppraiseSettings(partial) {
  const next = { ...readAppraiseSettings(), ...partial };
  fs.mkdirSync(path.dirname(appraiseStatePath()), { recursive: true });
  fs.writeFileSync(appraiseStatePath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function applyPersistedAppraiseSettings(eng) {
  const saved = readAppraiseSettings();
  const prefs = readPreferences();
  eng.setSettings({
    cast_mode: prefs.perfectCastEnabled ? 'full' : 'short',
    auto_appraise_enabled: !!saved.auto_appraise_enabled,
    auto_appraise_mutation: saved.auto_appraise_mutation || 'Mythical',
    appraise_delay_ms: Number(saved.appraise_delay_ms) || 500,
    auto_appraise_click_x:
      saved.auto_appraise_click_x === '' || saved.auto_appraise_click_x == null
        ? ''
        : Number(saved.auto_appraise_click_x),
    auto_appraise_click_y:
      saved.auto_appraise_click_y === '' || saved.auto_appraise_click_y == null
        ? ''
        : Number(saved.auto_appraise_click_y)
  });
}

function registerMacroHotkeys() {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };

  const hotkeys = readHotkeys();
  globalShortcut.unregisterAll();

  const actions = {
    start_macro: () => {
      if (!ensureMacroAllowed().ok) return;
      getEngine().toggle();
    },
    start_appraise: () => {
      if (!ensureMacroAllowed().ok) return;
      getEngine().toggleAppraise();
    },
    fix_roblox: () => {
      if (!ensureMacroAllowed().ok) return;
      getEngine().fixRoblox().catch(() => {});
    },
    reload: () => {
      reloadMacroUi();
    },
    spear_assist: () => {
      // Beta — not wired yet
    },
    harpoon_assist: () => {
      // Broken — not wired yet
    }
  };

  const registered = {};
  const errors = [];

  for (const [action, handler] of Object.entries(actions)) {
    const accel = normalizeAccelerator(hotkeys[action] || DEFAULT_HOTKEYS[action]);
    if (!accel) continue;
    try {
      const ok = globalShortcut.register(accel, handler);
      if (!ok) errors.push(`${action}: could not register ${accel} (maybe in use)`);
      else registered[action] = accel;
    } catch (err) {
      errors.push(`${action}: ${err.message}`);
    }
  }

  return { ok: errors.length === 0, hotkeys: { ...DEFAULT_HOTKEYS, ...registered }, errors };
}

function unlockMacroRuntime() {
  if (process.platform !== 'win32') return;
  const allowed = ensureMacroAllowed();
  if (!allowed.ok) return;
  const eng = getEngine();
  applyPersistedAppraiseSettings(eng);
  eng.startWatchers();
  registerMacroHotkeys();
  eng.emitStatus();
  // Quiet startup check — if Roblox already updated, pull fresh offsets early.
  if (readPreferences().autoFixOffsets !== false) {
    eng.scheduleOffsetHeal({ force: false, reason: 'startup' });
  }
}

ipcMain.handle('macro:get-hotkeys', async () => {
  const hotkeys = readHotkeys();
  return {
    hotkeys,
    labels: Object.fromEntries(
      Object.entries(hotkeys).map(([action, accel]) => [action, formatHotkeyLabel(accel)])
    )
  };
});

ipcMain.handle('macro:set-hotkey', async (_event, action, accelerator) => {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_HOTKEYS, action)) {
    return { ok: false, error: 'Unknown hotkey action' };
  }

  const accel = normalizeAccelerator(accelerator);
  if (!accel) return { ok: false, error: 'Invalid key' };

  const hotkeys = readHotkeys();

  // Clear duplicates so one key maps to one action
  for (const [otherAction, otherKey] of Object.entries(hotkeys)) {
    if (otherAction !== action && normalizeAccelerator(otherKey) === accel) {
      hotkeys[otherAction] = '';
    }
  }

  hotkeys[action] = accel;
  writeHotkeys(hotkeys);

  const result = registerMacroHotkeys();
  const label = formatHotkeyLabel(accel);
  notifyHotkeyChanged(action, label);
  return {
    ok: true,
    hotkeys: readHotkeys(),
    labels: Object.fromEntries(
      Object.entries(readHotkeys()).map(([action, accel]) => [action, formatHotkeyLabel(accel)])
    ),
    register: result
  };
});

ipcMain.handle('appearance:get', async () => readAppearance());

ipcMain.handle('appearance:save', async (_event, payload) => {
  const saved = writeAppearance(payload || {});
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(appearanceBackgroundColor(saved.bg));
  }
  showDesktopNotification('Theme applied', saved.theme + ' theme saved.', 'success');
  return { ok: true, appearance: saved };
});

ipcMain.handle('preferences:get', async () => readPreferences());

ipcMain.handle('preferences:save', async (_event, payload) => {
  const saved = writePreferences(payload || {});
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'perfectCastEnabled')) {
    try {
      if (ensureMacroAllowed().ok) {
        getEngine().setSettings({ cast_mode: saved.perfectCastEnabled ? 'full' : 'short' });
      }
    } catch {
      // ignore before setup completes
    }
  }
  return { ok: true, preferences: saved };
});

ipcMain.handle('setup:get-status', async () => buildStatus());

ipcMain.handle('setup:install', async () => {
  // Packaged app already includes koffi — nothing to install for end users.
  if (isPackagedBuild()) {
    const status = buildStatus();
    if (status.ready) {
      sendProgress({ type: 'done', message: 'Setup complete. Macro is ready.' });
      unlockMacroRuntime();
      return { ok: true, status };
    }
    return {
      ok: false,
      error: 'This build is missing a required package. Re-download Macro.',
      status
    };
  }

  sendProgress({ type: 'phase', phase: 'install', message: 'Installing required packages…' });

  try {
    await runNpmInstall();
  } catch (err) {
    sendProgress({ type: 'error', message: err.message });
    return { ok: false, error: err.message, status: buildStatus() };
  }

  sendProgress({ type: 'phase', phase: 'verify', message: 'Verifying packages…' });

  for (const pkg of requirements.packages) {
    try {
      const resolved = require.resolve(pkg.name, { paths: [__dirname] });
      delete require.cache[resolved];
    } catch {
      // ignore
    }
  }

  const status = buildStatus();
  if (!status.ready) {
    const broken = status.items.filter((i) => i.status !== 'ready');
    const message = broken.map((i) => `${i.label}: ${i.error || i.status}`).join('; ');
    sendProgress({ type: 'error', message });
    return { ok: false, error: message, status };
  }

  writeSetupState({
    completed: true,
    completedAt: new Date().toISOString(),
    versions: Object.fromEntries(status.items.map((i) => [i.name, 'ok']))
  });

  sendProgress({ type: 'done', message: 'Setup complete. Macro is ready.' });
  unlockMacroRuntime();
  return { ok: true, status: buildStatus() };
});

ipcMain.handle('macro:get-status', async () => {
  const allowed = ensureMacroAllowed();
  if (!allowed.ok) return { ...allowed, phase: 'OFF', attached: false };
  return getEngine().getStatus();
});

ipcMain.handle('macro:start', async (_event, settings) => {
  const allowed = ensureMacroAllowed();
  if (!allowed.ok) return allowed;
  const eng = getEngine();
  eng.setSettings(readUiSettingsFromPayload(settings));
  return eng.start();
});

ipcMain.handle('macro:stop', async () => {
  const allowed = ensureMacroAllowed();
  if (!allowed.ok) return allowed;
  return getEngine().stop('OFF');
});

ipcMain.handle('macro:toggle', async (_event, settings) => {
  const allowed = ensureMacroAllowed();
  if (!allowed.ok) return allowed;
  const eng = getEngine();
  if (settings) eng.setSettings(readUiSettingsFromPayload(settings));
  return eng.toggle();
});

ipcMain.handle('macro:toggle-appraise', async (_event, settings) => {
  const allowed = ensureMacroAllowed();
  if (!allowed.ok) return allowed;
  const eng = getEngine();
  if (settings) eng.setSettings(readUiSettingsFromPayload(settings));
  return eng.toggleAppraise();
});

ipcMain.handle('macro:fix', async () => {
  const allowed = ensureMacroAllowed();
  if (!allowed.ok) return allowed;
  const result = await getEngine().fixRoblox();
  if (result.ok) {
    showDesktopNotification('Roblox fixed', 'Re-attached to Roblox successfully.', 'success');
  } else {
    showDesktopNotification('Fix failed', result.error || 'Could not re-attach to Roblox.', 'error');
  }
  return result;
});

ipcMain.handle('macro:set-settings', async (_event, settings) => {
  const allowed = ensureMacroAllowed();
  if (!allowed.ok) return allowed;
  const parsed = readUiSettingsFromPayload(settings);
  getEngine().setSettings(parsed);
  writeAppraiseSettings({
    auto_appraise_enabled: parsed.auto_appraise_enabled,
    auto_appraise_mutation: parsed.auto_appraise_mutation,
    appraise_delay_ms: parsed.appraise_delay_ms,
    auto_appraise_click_x: parsed.auto_appraise_click_x,
    auto_appraise_click_y: parsed.auto_appraise_click_y,
    custom_mutations: Array.isArray(settings.custom_mutations) ? settings.custom_mutations : []
  });
  return { ok: true };
});

ipcMain.handle('macro:get-appraise-settings', async () => {
  const saved = readAppraiseSettings();
  return {
    auto_appraise_enabled: !!saved.auto_appraise_enabled,
    auto_appraise_mutation: saved.auto_appraise_mutation || 'Mythical',
    appraise_delay_ms: Number(saved.appraise_delay_ms) || 500,
    auto_appraise_click_x: saved.auto_appraise_click_x ?? '',
    auto_appraise_click_y: saved.auto_appraise_click_y ?? '',
    custom_mutations: Array.isArray(saved.custom_mutations) ? saved.custom_mutations : []
  };
});

ipcMain.handle('macro:pick-appraise-point', async () => {
  const win32 = require('./src/win32');
  // Wait for right mouse button release after press (screen coords)
  const VK_RBUTTON = win32.VK_RBUTTON;
  const deadline = Date.now() + 30000;
  let wasDown = false;

  while (Date.now() < deadline) {
    const down = win32.isKeyDown(VK_RBUTTON);
    if (down) wasDown = true;
    if (wasDown && !down) {
      const pos = win32.getCursorPos();
      if (!pos) return { ok: false, error: 'Could not read cursor position' };
      writeAppraiseSettings({
        auto_appraise_click_x: pos.x,
        auto_appraise_click_y: pos.y
      });
      if (ensureMacroAllowed().ok) {
        getEngine().setSettings({
          auto_appraise_click_x: pos.x,
          auto_appraise_click_y: pos.y
        });
      }
      return { ok: true, x: pos.x, y: pos.y };
    }
    await new Promise((r) => setTimeout(r, 16));
  }

  return { ok: false, error: 'Timed out waiting for right-click' };
});

ipcMain.handle('macro:clear-appraise-point', async () => {
  writeAppraiseSettings({ auto_appraise_click_x: '', auto_appraise_click_y: '' });
  if (ensureMacroAllowed().ok) {
    getEngine().setSettings({ auto_appraise_click_x: '', auto_appraise_click_y: '' });
  }
  return { ok: true };
});

function createWindow() {
  const appearance = readAppearance();
  mainWindow = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 480,
    minHeight: 560,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: appearanceBackgroundColor(appearance.bg),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const win = mainWindow;
  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('console-message', (event) => {
    const msg = String(event.message || '');
    if (msg.includes('MACRO_SETUP_DONE')) {
      win.setMinimumSize(420, 700);
      win.setSize(420, 700);
      win.center();
      win.setBackgroundColor(appearanceBackgroundColor(readAppearance().bg));
      unlockMacroRuntime();
    }
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r'))) {
      reloadMacroUi();
      event.preventDefault();
    }
  });

  win.on('closed', () => {
    mainWindow = null;
    // Notification overlay is a hidden BrowserWindow — without this, the app
    // stays alive in the background and blocks the next launch (single-instance lock).
    disposeNotificationHost();
    if (engine) {
      engine.dispose();
      engine = null;
    }
    if (process.platform !== 'darwin') app.quit();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    setNotificationsEnabledGetter(() => readPreferences().notificationsEnabled);
    initNotificationHost(() => readAppearance());
    createWindow();
    if (buildStatus().ready) {
      // Watchers start after UI signals setup done, or immediately if already past setup
      setTimeout(() => {
        if (buildStatus().ready) unlockMacroRuntime();
      }, 2500);
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    disposeNotificationHost();
    if (engine) {
      engine.dispose();
      engine = null;
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
