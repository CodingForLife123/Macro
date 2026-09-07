/**
 * Roblox attach + DataModel / PlayerGui helpers.
 * AGPL-3.0-only — see NOTICE / LICENSE.
 */
'use strict';

const win32 = require('./win32');
const { loadOffsets } = require('./offsets');
const { MemorySession, isValidUserPointer } = require('./memory');

const FISCH_PLACE_ID = 16732694052;

class RobloxSession {
  constructor() {
    this.mem = new MemorySession();
    this.offsetsVersion = '';
    this.hwnd = 0;
    this.cached = {
      dataModel: 0,
      localPlayer: 0,
      playerGui: 0,
      workspace: 0,
      hotbar: 0
    };
    this.rod = '';
  }

  get attached() {
    return this.mem.ready;
  }

  get pid() {
    return this.mem.pid;
  }

  resetCaches() {
    this.cached = {
      dataModel: 0,
      localPlayer: 0,
      playerGui: 0,
      workspace: 0,
      hotbar: 0
    };
  }

  detach() {
    this.mem.detach();
    this.hwnd = 0;
    this.rod = '';
    this.resetCaches();
  }

  findRobloxPid() {
    return win32.findProcessIdByName(win32.ROBLOX_EXE);
  }

  attach(pid = 0) {
    const targetPid = pid || this.findRobloxPid();
    if (!targetPid) throw new Error('Roblox is not running.');

    this.detach();

    const { version, offsets } = loadOffsets();
    this.offsetsVersion = version;

    const hProcess = win32.openProcessForRead(targetPid);
    let base;
    try {
      base = win32.getMainModuleBase(hProcess);
    } finally {
      win32.closeHandle(hProcess);
    }

    this.mem.attach(targetPid, base, offsets);
    this.hwnd = win32.findBestWindowForPid(targetPid);

    const probe = this.probeOffsets();
    if (!probe.ok) {
      this.detach();
      throw new Error(probe.error);
    }

    return true;
  }

  ensureReady({ attemptAttach = true } = {}) {
    const currentPid = this.findRobloxPid();
    if (!currentPid) {
      this.detach();
      return { ok: false, error: 'Roblox is not running.', code: 'no_roblox' };
    }

    if (this.attached && this.pid === currentPid) {
      this.hwnd = this.hwnd || win32.findBestWindowForPid(currentPid);
      const probe = this.probeOffsets();
      if (!probe.ok) {
        this.detach();
        return { ok: false, error: probe.error, code: probe.code };
      }
      return { ok: true };
    }

    if (!attemptAttach) {
      return { ok: false, error: 'Roblox is not attached.', code: 'not_attached' };
    }

    try {
      this.attach(currentPid);
      return { ok: true };
    } catch (err) {
      const message = err.message || String(err);
      return {
        ok: false,
        error: message,
        code: /not in Fisch/i.test(message)
          ? 'not_in_fisch'
          : /still loading|not ready/i.test(message)
            ? 'loading'
            : /offset/i.test(message)
              ? 'offsets'
              : 'attach_failed'
      };
    }
  }

  focusGame() {
    if (!this.hwnd) this.hwnd = win32.findBestWindowForPid(this.pid);
    return win32.focusWindow(this.hwnd);
  }

  resolveDataModelViaFake() {
    const o = this.mem.offsets;
    if (!o.FakeDataModelPointer || !o.FakeDataModelToDataModel) return 0;
    const fake = this.mem.readPointer(this.mem.base + o.FakeDataModelPointer);
    if (!isValidUserPointer(fake)) return 0;
    return this.mem.readPointer(fake + o.FakeDataModelToDataModel);
  }

  resolveDataModelViaVisual() {
    const o = this.mem.offsets;
    if (!o.VisualEnginePointer || !o.VisualEngineToDataModel1 || !o.VisualEngineToDataModel2) {
      return 0;
    }
    const ve = this.mem.readPointer(this.mem.base + o.VisualEnginePointer);
    if (!isValidUserPointer(ve)) return 0;
    const fake = this.mem.readPointer(ve + o.VisualEngineToDataModel1);
    if (!isValidUserPointer(fake)) return 0;
    return this.mem.readPointer(fake + o.VisualEngineToDataModel2);
  }

  getDataModel() {
    if (this.cached.dataModel) return this.cached.dataModel;
    let dm = this.resolveDataModelViaFake();
    if (!isValidUserPointer(dm)) dm = this.resolveDataModelViaVisual();
    if (isValidUserPointer(dm)) this.cached.dataModel = dm;
    return this.cached.dataModel || 0;
  }

  testOffsets() {
    return this.probeOffsets().ok;
  }

  /**
   * Structural offset check + Fisch place gate (matches XTernal TestAndHealOffsets intent).
   * DataModel can resolve on the Roblox home screen — that is NOT an offsets failure.
   */
  probeOffsets() {
    this.cached.dataModel = 0;
    const dm = this.getDataModel();
    if (!isValidUserPointer(dm)) {
      return {
        ok: false,
        code: 'loading',
        error: 'Roblox is still loading. Open Fisch and wait a moment.'
      };
    }

    let className = '';
    try {
      className = this.mem.readClassName(dm);
    } catch {
      className = '';
    }
    if (className !== 'DataModel') {
      return {
        ok: false,
        code: 'loading',
        error: 'Roblox is still loading. Open Fisch and wait a moment.'
      };
    }

    let foundWorkspace = false;
    let foundPlayers = false;
    try {
      for (const child of this.mem.readChildren(dm)) {
        const cls = this.mem.readClassName(child);
        if (cls === 'Workspace') foundWorkspace = true;
        if (cls === 'Players') foundPlayers = true;
        if (foundWorkspace && foundPlayers) break;
      }
    } catch {
      return {
        ok: false,
        code: 'loading',
        error: 'Roblox is still loading. Open Fisch and wait a moment.'
      };
    }

    if (!foundWorkspace || !foundPlayers) {
      return {
        ok: false,
        code: 'offsets',
        error:
          'Offsets look wrong for this Roblox build. Auto-fix will retry, or press Fix Roblox.'
      };
    }

    // Keep DataModel cached after a good structural pass.
    this.cached.dataModel = dm;

    const placeId = this.getPlaceId();
    if (placeId && placeId !== FISCH_PLACE_ID) {
      return {
        ok: false,
        code: 'not_in_fisch',
        error: "You're not in Fisch yet. Open Fisch, then start the macro."
      };
    }

    // PlaceId 0 is common while joining / on menu — treat as waiting, not broken offsets.
    if (!placeId) {
      return {
        ok: false,
        code: 'not_in_fisch',
        error: "You're not in Fisch yet. Open Fisch, then start the macro."
      };
    }

    return { ok: true, code: 'ok', error: '' };
  }

  isInFischGame() {
    try {
      return this.getPlaceId() === FISCH_PLACE_ID;
    } catch {
      return false;
    }
  }

  getPlaceId() {
    const dm = this.getDataModel();
    if (!dm || this.mem.offsets.PlaceId == null) return 0;
    const buf = this.mem.readBytes(dm + this.mem.offsets.PlaceId, 8);
    if (!buf) return 0;
    return Number(buf.readBigUInt64LE(0));
  }

  getPlayers() {
    const dm = this.getDataModel();
    if (!dm) return 0;
    for (const child of this.mem.readChildren(dm)) {
      if (this.mem.readClassName(child) === 'Players') return child;
    }
    return 0;
  }

  getLocalPlayer() {
    if (this.cached.localPlayer) return this.cached.localPlayer;
    const players = this.getPlayers();
    if (!players || this.mem.offsets.LocalPlayer == null) return 0;
    const lp = this.mem.readPointer(players + this.mem.offsets.LocalPlayer);
    if (lp) this.cached.localPlayer = lp;
    return lp || 0;
  }

  findPlayerGui() {
    if (this.cached.playerGui) return this.cached.playerGui;
    const lp = this.getLocalPlayer();
    if (!lp) return 0;
    for (const child of this.mem.readChildren(lp)) {
      if (this.mem.readClassName(child) === 'PlayerGui') {
        this.cached.playerGui = child;
        return child;
      }
    }
    return 0;
  }

  getWorkspaceRoot() {
    if (this.cached.workspace) return this.cached.workspace;
    const dm = this.getDataModel();
    if (!dm) return 0;
    for (const child of this.mem.readChildren(dm)) {
      const name = this.mem.readInstanceName(child);
      const cls = this.mem.readClassName(child);
      if (name === 'Workspace' || cls === 'Workspace') {
        this.cached.workspace = child;
        return child;
      }
    }
    return 0;
  }

  getHotbarGui() {
    if (this.cached.hotbar) return this.cached.hotbar;
    const lp = this.getLocalPlayer();
    if (!lp) return 0;
    const pg = this.mem.findChildByClass(lp, 'PlayerGui');
    if (!pg) return 0;
    const bp = this.mem.findChildByName(pg, 'backpack');
    if (!bp) return 0;
    const hotbar = this.mem.findChildByName(bp, 'hotbar');
    if (hotbar) this.cached.hotbar = hotbar;
    return hotbar || 0;
  }

  normalizeRodText(text) {
    const { normalizeRodDisplayText } = require('./rods');
    return normalizeRodDisplayText(text);
  }

  getCharacterModel() {
    const workspace = this.getWorkspaceRoot();
    const localPlayer = this.getLocalPlayer();
    if (!workspace || !localPlayer) return 0;
    const playerName = this.mem.readInstanceName(localPlayer);
    if (!playerName || playerName === '<null>') return 0;
    return this.mem.findChildByName(workspace, playerName);
  }

  getEquippedToolName() {
    const character = this.getCharacterModel();
    if (!character) return '';
    for (const child of this.mem.readChildren(character)) {
      if (this.mem.readClassName(child) === 'Tool') {
        return this.mem.readInstanceName(child);
      }
    }
    return '';
  }

  scanHotbarRod() {
    const {
      displayRodName,
      extractFishingGearName,
      isFishingGearText,
      isRecognizedRodText,
      normalizeRodDisplayText
    } = require('./rods');

    // Prefer equipped tool when it is fishing gear
    try {
      const equipped = this.getEquippedToolName();
      if (equipped && isFishingGearText(equipped)) {
        return extractFishingGearName(equipped) || displayRodName(equipped);
      }
    } catch {
      // ignore
    }

    const hotbar = this.getHotbarGui();
    if (!hotbar) return '';

    let fallback = '';
    let spearFallback = '';

    for (const slot of this.mem.readChildren(hotbar)) {
      if (this.mem.readClassName(slot) !== 'ImageButton') continue;
      if (this.mem.readInstanceName(slot) !== 'ItemTemplate') continue;
      const nameInst = this.mem.findChildByName(slot, 'ItemName');
      if (!nameInst) continue;

      const raw = normalizeRodDisplayText(this.mem.readGuiText(nameInst));
      if (!raw) continue;

      const pure = extractFishingGearName(raw);
      if (pure) return pure;

      if (isRecognizedRodText(raw)) return displayRodName(raw);

      const lower = raw.toLowerCase();
      if (!spearFallback && lower.includes('spear')) {
        spearFallback = displayRodName(raw);
      }
      if (!fallback) fallback = displayRodName(raw);
    }

    return spearFallback || fallback;
  }

  refreshRod() {
    const rod = this.scanHotbarRod();
    if (rod) this.rod = rod;
    return this.rod;
  }

  findDescendantFrameByName(rootAddr, targetName, maxNodes = 400) {
    const queue = [rootAddr];
    let index = 0;
    while (index < queue.length && index < maxNodes) {
      const current = queue[index++];
      if (
        this.mem.readInstanceName(current) === targetName &&
        this.mem.readClassName(current) === 'Frame'
      ) {
        return current;
      }
      for (const child of this.mem.readChildren(current)) queue.push(child);
    }
    return 0;
  }
}

module.exports = {
  RobloxSession,
  FISCH_PLACE_ID
};
