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
    /** Currently held fishing gear (empty when unequipped). */
    this.equippedRod = '';
    /** Last known fishing-gear display name (used to find its hotbar slot after moves). */
    this.preferredRodName = '';
    this._equippedToolAddr = 0;
    this._equippedToolCachedAt = 0;
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
    this.equippedRod = '';
    this.preferredRodName = '';
    this._equippedToolAddr = 0;
    this._equippedToolCachedAt = 0;
    this._pidCachedAt = 0;
    this._probeOkUntil = 0;
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
    const now = Date.now();
    // Avoid CreateToolhelp32Snapshot every 1–2s while already attached.
    let currentPid = this.pid;
    if (!this.attached || !this._pidCachedAt || now - this._pidCachedAt > 2500) {
      currentPid = this.findRobloxPid();
      this._pidCachedAt = now;
    }
    if (!currentPid) {
      this.detach();
      return { ok: false, error: 'Roblox is not running.', code: 'no_roblox' };
    }

    if (this.attached && this.pid === currentPid) {
      this.hwnd = this.hwnd || win32.findBestWindowForPid(currentPid);
      // Soft re-probe only every few seconds — full DataModel walk stutters Roblox.
      if (!this._probeOkUntil || now > this._probeOkUntil) {
        const probe = this.probeOffsets();
        if (!probe.ok) {
          this.detach();
          return { ok: false, error: probe.error, code: probe.code };
        }
        this._probeOkUntil = now + 4000;
      }
      return { ok: true };
    }

    if (!attemptAttach) {
      return { ok: false, error: 'Roblox is not attached.', code: 'not_attached' };
    }

    try {
      this.attach(currentPid);
      this._pidCachedAt = now;
      this._probeOkUntil = now + 4000;
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
    // Keep DataModel cache when possible — wiping every probe caused hitch spikes.
    let dm = this.cached.dataModel;
    if (!isValidUserPointer(dm)) {
      dm = this.getDataModel();
    }
    if (!isValidUserPointer(dm)) {
      this.cached.dataModel = 0;
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
      this.cached.dataModel = 0;
      return {
        ok: false,
        code: 'loading',
        error: 'Roblox is still loading. Open Fisch and wait a moment.'
      };
    }
    this.cached.dataModel = dm;

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

  /** Fast equip check (no hotbar walk) for activity log polling. */
  refreshEquippedRod() {
    const {
      displayRodName,
      extractFishingGearName,
      isFishingGearText
    } = require('./rods');

    let equippedRod = '';
    try {
      const equipped = this.getEquippedToolName();
      if (equipped && isFishingGearText(equipped)) {
        equippedRod = extractFishingGearName(equipped) || displayRodName(equipped);
      }
    } catch {
      // ignore
    }
    this.equippedRod = equippedRod;
    if (equippedRod) this.rod = equippedRod;
    return equippedRod;
  }

  getEquippedToolName() {
    const now = Date.now();
    // Reuse last Tool pointer briefly — avoids re-walking a huge character tree.
    if (
      this._equippedToolAddr &&
      this._equippedToolCachedAt &&
      now - this._equippedToolCachedAt < 300
    ) {
      try {
        if (this.mem.readClassName(this._equippedToolAddr) === 'Tool') {
          const name = this.mem.readInstanceName(this._equippedToolAddr);
          if (name) return name;
        }
      } catch {
        // fall through to rescan
      }
      this._equippedToolAddr = 0;
    }

    const character = this.getCharacterModel();
    if (!character) {
      this._equippedToolAddr = 0;
      this._equippedToolCachedAt = now;
      return '';
    }

    const children = this.mem.readChildren(character);
    for (let i = children.length - 1; i >= 0; i--) {
      try {
        if (this.mem.readClassName(children[i]) === 'Tool') {
          this._equippedToolAddr = children[i];
          this._equippedToolCachedAt = now;
          return this.mem.readInstanceName(children[i]);
        }
      } catch {
        // ignore
      }
    }
    this._equippedToolAddr = 0;
    this._equippedToolCachedAt = now;
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
    let harpoonFallback = '';

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
      if (!harpoonFallback && lower.includes('harpoon')) {
        harpoonFallback = displayRodName(raw);
      }
      if (!spearFallback && lower.includes('spear')) {
        spearFallback = displayRodName(raw);
      }
      if (!fallback) fallback = displayRodName(raw);
    }

    return harpoonFallback || spearFallback || fallback;
  }

  readHotbarItemSlotKey(slotAddr) {
    // Fisch labels the slot with a TextLabel (usually "1"–"9" or "0" for slot 10).
    for (const child of this.mem.readChildren(slotAddr)) {
      if (this.mem.readClassName(child) !== 'TextLabel') continue;
      const key = String(this.mem.readGuiText(child) || '')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (/^[0-9]$/.test(key)) return key;
    }
    return '';
  }

  /**
   * Scan hotbar ItemTemplates and return fishing-gear entries with their live slot keys.
   * Slot keys come from the UI label, so moving a rod to another hotbar slot still works.
   * @returns {{ key: string, name: string, kind: 'rod'|'harpoon'|'spear'|'gear' }[]}
   */
  listHotbarFishingGear() {
    const {
      displayRodName,
      extractFishingGearName,
      isFishingGearText,
      isHarpoonText,
      isRecognizedRodText,
      isSpearText,
      normalizeRodDisplayText,
      resolveGearType
    } = require('./rods');

    const hotbar = this.getHotbarGui();
    if (!hotbar) return [];

    const items = [];
    for (const slot of this.mem.readChildren(hotbar)) {
      if (this.mem.readClassName(slot) !== 'ImageButton') continue;
      if (this.mem.readInstanceName(slot) !== 'ItemTemplate') continue;
      const nameInst = this.mem.findChildByName(slot, 'ItemName');
      if (!nameInst) continue;

      const raw = normalizeRodDisplayText(this.mem.readGuiText(nameInst));
      if (!raw) continue;
      if (
        !extractFishingGearName(raw) &&
        !isRecognizedRodText(raw) &&
        !isFishingGearText(raw) &&
        !isHarpoonText(raw)
      ) {
        continue;
      }

      const key = this.readHotbarItemSlotKey(slot);
      if (!key) continue;

      const name = extractFishingGearName(raw) || displayRodName(raw) || raw;
      const kind = resolveGearType(name) || (isSpearText(name) ? 'spear' : 'gear');

      items.push({ key, name, kind });
    }
    return items;
  }

  /**
   * Pick which hotbar key to press for fishing gear.
   * Prefer the user's last/known rod name, then rods, then harpoons/spears.
   * Returns null when nothing can be resolved — never guesses slot "1".
   */
  resolveFishingGearHotbarSlot(preferredName = '') {
    const items = this.listHotbarFishingGear();
    if (!items.length) return null;

    const want = String(
      preferredName || this.preferredRodName || this.rod || this.equippedRod || ''
    )
      .trim()
      .toLowerCase();

    if (want) {
      const exact = items.find((item) => item.name.toLowerCase() === want);
      if (exact) return exact;
      const partial = items.find(
        (item) =>
          item.name.toLowerCase().includes(want) ||
          want.includes(item.name.toLowerCase())
      );
      if (partial) return partial;
    }

    return (
      items.find((item) => item.kind === 'rod') ||
      items.find((item) => item.kind === 'harpoon') ||
      items.find((item) => item.kind === 'spear') ||
      items[0] ||
      null
    );
  }

  isAnythingEquipped() {
    try {
      return !!this.getEquippedToolName();
    } catch {
      return false;
    }
  }

  /**
   * Equip a **rod** if hands are empty.
   * Fisch **T** is rod-only. Harpoons are never auto-equipped (player does that).
   * See GEAR.md.
   */
  ensureRodEquipped() {
    const win32 = require('./win32');
    const { resolveGearType } = require('./rods');
    try {
      this.refreshEquippedRod();
      if (this.equippedRod) {
        this.preferredRodName = this.equippedRod;
        const kind = resolveGearType(this.equippedRod);
        // Harpoon/spear already in hand = player equipped manually — never press T.
        if (kind === 'harpoon' || kind === 'spear') {
          return {
            ok: true,
            already: true,
            rod: this.equippedRod,
            kind,
            method: 'manual'
          };
        }
        return {
          ok: true,
          already: true,
          rod: this.equippedRod,
          kind: 'rod',
          method: 'already'
        };
      }

      // Something else in hand (fish, totem, etc.) — don't toggle T.
      if (this.isAnythingEquipped()) {
        return {
          ok: false,
          already: false,
          rod: '',
          kind: '',
          method: 'blocked',
          error: 'Unequip the item in your hand first, then start fishing'
        };
      }

      // Empty hands → T equips the rod only (not harpoon).
      this.refreshRod();
      this.focusGame();
      if (!win32.tapCharKey('T')) {
        return {
          ok: false,
          already: false,
          rod: this.rod || '',
          kind: '',
          method: 't',
          error: 'Failed to press T to equip rod'
        };
      }
      win32.sleepSync(200);
      this.refreshRod();

      const kind = resolveGearType(this.equippedRod);
      if (this.equippedRod && kind === 'rod') {
        this.preferredRodName = this.equippedRod;
        return {
          ok: true,
          already: false,
          rod: this.equippedRod,
          kind: 'rod',
          method: 't'
        };
      }

      // T should not pull a harpoon; if it did, still don't keep retrying.
      if (this.equippedRod && kind === 'harpoon') {
        return {
          ok: true,
          already: false,
          rod: this.equippedRod,
          kind: 'harpoon',
          method: 'manual',
          error: ''
        };
      }

      return {
        ok: false,
        already: false,
        rod: this.rod || '',
        kind: kind || '',
        method: 't',
        error:
          'Pressed T but no rod equipped — select a rod in Fisch first (harpoons are manual)'
      };
    } catch (err) {
      return {
        ok: false,
        already: false,
        rod: '',
        kind: '',
        method: '',
        error: err && err.message ? err.message : String(err)
      };
    }
  }

  refreshRod() {
    const {
      displayRodName,
      extractFishingGearName,
      isFishingGearText
    } = require('./rods');

    let equippedRod = '';
    try {
      const equipped = this.getEquippedToolName();
      if (equipped && isFishingGearText(equipped)) {
        equippedRod = extractFishingGearName(equipped) || displayRodName(equipped);
      }
    } catch {
      // ignore
    }
    this.equippedRod = equippedRod;

    const scanned = this.scanHotbarRod();
    if (equippedRod) {
      this.rod = equippedRod;
      this.preferredRodName = equippedRod;
    } else if (scanned) {
      this.rod = scanned;
      if (!this.preferredRodName) this.preferredRodName = scanned;
    }

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
