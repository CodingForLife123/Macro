/**
 * Core Fisch fishing cycle (cast → shake → reel) + special rods.
 * AGPL-3.0-only — see NOTICE / LICENSE (ported from OpenMacro XTernal Fish.ahk).
 */
'use strict';

const win32 = require('./win32');
const {
  createControllerForRod,
  isTranquilityNoteName,
  FishingController
} = require('./controllers');
const {
  isTranquilityRodText,
  isLullabyRodText,
  isBellonaRodText,
  isRequiemRodText,
  resolveRodKind
} = require('./rods');
const { AppraiseController } = require('./appraise');

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function defaultSettings() {
  return {
    update_rate: 12,
    prediction_strength: 4.0,
    neutral_duty_cycle: 0.35,
    close_threshold: 0.04,
    velocity_damping: 30,
    proportional_gain: 0.65,
    derivative_gain: 0.18,
    edge_boundary: 0.08,
    cast_mode: 'full',
    cast_power_custom: 96,
    cast_timeout_ms: 15000,
    pre_cast_delay_ms: 0,
    post_cast_delay_ms: 150,
    cast_on_timeout: true,
    fishing_action_delay_ms: 0,
    completion_threshold: 99.7,
    shake_interval_ms: 25,
    lullaby_mode: 'Prismatic',
    auto_appraise_enabled: false,
    auto_appraise_mutation: 'Mythical',
    appraise_delay_ms: 500,
    auto_appraise_click_x: '',
    auto_appraise_click_y: ''
  };
}

class FishingMacro {
  constructor(session, options = {}) {
    this.session = session;
    this.settings = { ...defaultSettings(), ...(options.settings || {}) };
    this.controller = new FishingController(this);
    this.appraise = new AppraiseController(this);
    this.state = this.createState();
  }

  createState() {
    return {
      phase: 'OFF',
      cycleEnabled: false,
      powerPercent: '',
      progressPercent: '',
      isHolding: false,
      isHoldingRight: false,
      lastActionAt: 0,
      lastRightActionAt: 0,
      castThreshold: 96,
      castWaitTimeoutMs: 15000,
      fishingEndGraceMs: 100,
      castStartedAt: 0,
      castReleasedAt: 0,
      castBarSeen: false,
      fishingLostAt: 0,
      completionReached: false,
      outcomeResolved: false,
      bellonaLeftCompletionReached: false,
      bellonaRightCompletionReached: false,
      fishCaughtCount: 0,
      fishLostCount: 0,
      castTimeoutCount: 0,
      shakingIntervalMs: 25,
      lastShakedAt: 0,
      activatedUiNav: false,
      shakeButtonAddr: 0,
      reelBarAddr: 0,
      fishAddr: 0,
      playerbarAddr: 0,
      progressBarAddr: 0,
      powerBarAddr: 0,
      appraiseSubvaluesAddr: 0,
      appraiseLastClickAt: 0,
      appraiseWaitStartedAt: 0,
      appraiseSubvaluesRetryCount: 0,
      appraiseSubvaluesLastRetryAt: 0,
      appraiseStartCoins: '',
      appraiseEndCoins: '',
      appraiseState: 'IDLE',
      appraiseLastError: ''
    };
  }

  applySettings(partial) {
    this.settings = { ...this.settings, ...partial };
  }

  now() {
    return Date.now();
  }

  resolveCastThreshold() {
    switch (this.settings.cast_mode) {
      case 'short':
        return 28;
      case 'custom':
        return clamp(Number(this.settings.cast_power_custom) || 96, 1, 100);
      default:
        return 96;
    }
  }

  effectiveActionDelayMs() {
    // XTernal: Requiem forces 165ms session-only
    if (isRequiemRodText(this.session.rod)) return 165;
    return Number(this.settings.fishing_action_delay_ms) || 0;
  }

  clearPhaseCache() {
    this.state.reelBarAddr = 0;
    this.state.fishAddr = 0;
    this.state.playerbarAddr = 0;
    this.state.progressBarAddr = 0;
    this.state.powerBarAddr = 0;
    this.state.shakeButtonAddr = 0;
  }

  ensureUiNavigation() {
    if (this.state.activatedUiNav) return;
    this.session.focusGame();
    win32.tapBackslash();
    this.state.activatedUiNav = true;
  }

  holdMouse(force = false) {
    if (this.state.isHolding) return;
    const delay = this.effectiveActionDelayMs();
    if (
      !force &&
      (this.state.phase === 'FISHING' || this.state.phase === 'BELLONA') &&
      delay > 0 &&
      this.state.lastActionAt &&
      this.now() - this.state.lastActionAt < delay
    ) {
      return;
    }
    win32.mouseLeftDown();
    this.state.isHolding = true;
    this.state.lastActionAt = this.now();
  }

  releaseMouse(force = false) {
    if (!this.state.isHolding) return;
    const delay = this.effectiveActionDelayMs();
    if (
      !force &&
      (this.state.phase === 'FISHING' || this.state.phase === 'BELLONA') &&
      delay > 0 &&
      this.state.lastActionAt &&
      this.now() - this.state.lastActionAt < delay
    ) {
      return;
    }
    win32.mouseLeftUp();
    this.state.isHolding = false;
    this.state.lastActionAt = this.now();
  }

  holdRightMouse(force = false) {
    if (this.state.isHoldingRight) return;
    const delay = this.effectiveActionDelayMs();
    if (
      !force &&
      delay > 0 &&
      this.state.lastRightActionAt &&
      this.now() - this.state.lastRightActionAt < delay
    ) {
      return;
    }
    win32.mouseRightDown();
    this.state.isHoldingRight = true;
    this.state.lastRightActionAt = this.now();
  }

  releaseRightMouse(force = false) {
    if (!this.state.isHoldingRight) return;
    const delay = this.effectiveActionDelayMs();
    if (
      !force &&
      delay > 0 &&
      this.state.lastRightActionAt &&
      this.now() - this.state.lastRightActionAt < delay
    ) {
      return;
    }
    win32.mouseRightUp();
    this.state.isHoldingRight = false;
    this.state.lastRightActionAt = this.now();
  }

  releaseAllFishingMouse(force = false) {
    this.releaseMouse(force);
    this.releaseRightMouse(force);
  }

  selectController() {
    this.session.refreshRod();
    this.controller = createControllerForRod(this, this.session.rod);
  }

  initializeCastCycle() {
    this.ensureUiNavigation();

    this.state.powerPercent = '';
    this.state.progressPercent = '';
    this.state.castStartedAt = this.now();
    this.state.castReleasedAt = 0;
    this.state.castBarSeen = false;
    this.state.fishingLostAt = 0;
    this.state.completionReached = false;
    this.state.outcomeResolved = false;
    this.state.bellonaLeftCompletionReached = false;
    this.state.bellonaRightCompletionReached = false;
    this.state.lastShakedAt = 0;
    this.state.lastActionAt = 0;
    this.state.lastRightActionAt = 0;
    this.state.powerBarAddr = 0;
    this.state.shakeButtonAddr = 0;
    this.state.castThreshold = this.resolveCastThreshold();
    this.state.castWaitTimeoutMs = Math.max(3000, Number(this.settings.cast_timeout_ms) || 15000);
    this.state.shakingIntervalMs = Number(this.settings.shake_interval_ms) || 25;
    this.state.phase = 'CASTING';
  }

  startCycle() {
    this.releaseAllFishingMouse(true);
    this.selectController();
    this.controller.reset();
    this.state.cycleEnabled = true;
    this.initializeCastCycle();
  }

  stopCycle(nextPhase = 'OFF') {
    const finalProgress = this.state.progressPercent;
    const wasAppraise = this.state.phase === 'APPRAISE';
    this.releaseAllFishingMouse(true);
    this.controller.reset();
    this.state.powerPercent = '';
    this.state.castStartedAt = 0;
    this.state.castReleasedAt = 0;
    this.state.castBarSeen = false;
    this.state.progressPercent = nextPhase === 'DONE' && finalProgress !== '' ? finalProgress : '';
    this.state.fishingLostAt = 0;
    this.state.completionReached = false;
    this.state.outcomeResolved = false;
    this.state.bellonaLeftCompletionReached = false;
    this.state.bellonaRightCompletionReached = false;
    this.state.lastShakedAt = 0;
    this.state.lastActionAt = 0;
    this.state.lastRightActionAt = 0;
    this.clearPhaseCache();
    this.state.phase = nextPhase;
    if (nextPhase === 'OFF') {
      this.state.cycleEnabled = false;
      if (wasAppraise || this.state.appraiseState !== 'IDLE') {
        this.appraise.clearCache();
        this.appraise.setStatus('Stopped.');
      }
    }
  }

  getReelGui() {
    const playerGui = this.session.findPlayerGui();
    if (!playerGui) return 0;
    return this.session.mem.findChildByName(playerGui, 'reel');
  }

  isReelGuiVisible(reelGui = 0) {
    const gui = reelGui || this.getReelGui();
    if (!gui) return false;
    const offset = this.session.mem.offsets.ScreenGuiEnabled;
    if (offset == null) return true;
    return !!this.session.mem.readByte(gui + offset);
  }

  getReelBarContext() {
    const reelGui = this.getReelGui();
    if (!reelGui) {
      this.state.reelBarAddr = 0;
      this.state.fishAddr = 0;
      this.state.playerbarAddr = 0;
      return null;
    }

    const mem = this.session.mem;
    if (
      mem.isCachedAddrValid(this.state.reelBarAddr, 'bar') &&
      this.state.fishAddr &&
      this.state.playerbarAddr
    ) {
      return {
        bar: this.state.reelBarAddr,
        fish: this.state.fishAddr,
        playerbar: this.state.playerbarAddr
      };
    }

    this.state.reelBarAddr = 0;
    this.state.fishAddr = 0;
    this.state.playerbarAddr = 0;

    const barFrame = mem.findChildByName(reelGui, 'bar');
    if (!barFrame) return null;

    this.state.reelBarAddr = barFrame;
    this.state.fishAddr = mem.findChildByName(barFrame, 'fish');
    this.state.playerbarAddr = mem.findChildByName(barFrame, 'playerbar');

    return {
      bar: barFrame,
      fish: this.state.fishAddr,
      playerbar: this.state.playerbarAddr
    };
  }

  hasActiveFishingContext(ctx = null) {
    const c = ctx || this.getReelBarContext();
    return !!(c && c.fish && c.playerbar);
  }

  buildReelContext(reelGui) {
    if (!reelGui) return null;
    const mem = this.session.mem;
    const barFrame = mem.findChildByName(reelGui, 'bar');
    if (!barFrame) return null;
    const progressFrame = mem.findChildByName(barFrame, 'progress');
    const progressBar = progressFrame ? mem.findChildByName(progressFrame, 'bar') : 0;
    const barPos = mem.readFramePosition(barFrame);
    return {
      reel: reelGui,
      bar: barFrame,
      fish: mem.findChildByName(barFrame, 'fish'),
      playerbar: mem.findChildByName(barFrame, 'playerbar'),
      progress: progressFrame,
      progressBar,
      barX: barPos.X
    };
  }

  getReelContexts() {
    const playerGui = this.session.findPlayerGui();
    const contexts = [];
    if (!playerGui) return contexts;

    for (const child of this.session.mem.readChildren(playerGui)) {
      if (this.session.mem.readInstanceName(child) !== 'reel') continue;
      if (this.session.mem.readClassName(child) !== 'ScreenGui') continue;
      const ctx = this.buildReelContext(child);
      if (ctx) contexts.push(ctx);
    }

    contexts.sort((a, b) => a.barX - b.barX);
    return contexts;
  }

  hasActiveBellonaContext() {
    for (const ctx of this.getReelContexts()) {
      if (ctx && ctx.fish && ctx.playerbar) return true;
    }
    return false;
  }

  readReelCompletionPercent(ctx) {
    if (!ctx || !ctx.progressBar) return null;
    const size = this.session.mem.readFrameSize(ctx.progressBar);
    return clamp(size.X * 100, 0, 100);
  }

  getReelProgressContext() {
    const reelGui = this.getReelGui();
    if (!reelGui) {
      this.state.progressBarAddr = 0;
      return null;
    }

    const mem = this.session.mem;
    if (
      mem.isCachedAddrValid(this.state.progressBarAddr, 'bar') &&
      mem.isCachedAddrValid(this.state.reelBarAddr, 'bar')
    ) {
      return { progressBar: this.state.progressBarAddr };
    }

    this.state.progressBarAddr = 0;
    const controlBar = mem.isCachedAddrValid(this.state.reelBarAddr, 'bar')
      ? this.state.reelBarAddr
      : mem.findChildByName(reelGui, 'bar');
    if (!controlBar) return null;

    const progressFrame = mem.findChildByName(controlBar, 'progress');
    if (!progressFrame) return null;
    const progressBar = mem.findChildByName(progressFrame, 'bar');
    if (!progressBar) return null;

    this.state.progressBarAddr = progressBar;
    return { progressBar };
  }

  getFishingCompletionPercent() {
    const ctx = this.getReelProgressContext();
    if (!ctx || !ctx.progressBar) return null;
    const size = this.session.mem.readFrameSize(ctx.progressBar);
    return clamp(size.X * 100, 0, 100);
  }

  isNoteInPlayerBar(x, ctx = null, padding = 0) {
    const c = ctx || this.getReelBarContext();
    if (!c || !c.playerbar) return false;
    const playerbarPos = this.session.mem.readFramePosition(c.playerbar);
    const playerbarSize = this.session.mem.readFrameSize(c.playerbar);
    const halfWidth = playerbarSize.X / 2;
    return x >= playerbarPos.X - halfWidth - padding && x <= playerbarPos.X + halfWidth + padding;
  }

  getActiveNoteTarget() {
    const mem = this.session.mem;
    let noteContainer = 0;
    if (mem.isCachedAddrValid(this.state.reelBarAddr, 'bar')) {
      noteContainer = mem.findChildByName(this.state.reelBarAddr, 'noteContainer');
    } else {
      const ctx = this.getReelBarContext();
      if (ctx && ctx.bar) noteContainer = mem.findChildByName(ctx.bar, 'noteContainer');
    }
    if (!noteContainer) return null;

    let best = null;
    let bestY = -999999;
    for (const noteName of ['note1', 'note2']) {
      const noteAddr = mem.findChildByName(noteContainer, noteName);
      if (!noteAddr) continue;
      const pos = mem.readNotePosition(noteAddr);
      if (pos.sy > 0.55 || pos.sy < -30) continue;
      if (pos.sy > bestY) {
        bestY = pos.sy;
        best = { sx: pos.sx, sy: pos.sy };
      }
    }
    return best;
  }

  getTranquilityGui() {
    const playerGui = this.session.findPlayerGui();
    if (!playerGui) return 0;
    return this.session.mem.findChildByName(playerGui, 'TranquilityRodRhythmGame');
  }

  getTranquilityRoot(gui = 0) {
    const g = gui || this.getTranquilityGui();
    return g ? this.session.mem.findChildByName(g, 'RhythmGame') : 0;
  }

  getTranquilityLaneContainer(root = 0) {
    const r = root || this.getTranquilityRoot();
    return r ? this.session.mem.findChildByName(r, 'LaneContainer') : 0;
  }

  getTranquilityLane(index, container = 0) {
    const c = container || this.getTranquilityLaneContainer();
    return c ? this.session.mem.findChildByName(c, 'Lane' + index) : 0;
  }

  getTranquilityHealthFill(root = 0) {
    const r = root || this.getTranquilityRoot();
    if (!r) return 0;
    const healthBar = this.session.mem.findChildByName(r, 'HealthBar');
    return healthBar ? this.session.mem.findChildByName(healthBar, 'Fill') : 0;
  }

  readTranquilityProgressPercent(root = 0) {
    const fill = this.getTranquilityHealthFill(root);
    if (!fill) return null;
    const size = this.session.mem.readFrameSize(fill);
    return clamp(size.X * 100, 0, 100);
  }

  getTranquilityLaneKey(index, root = 0, lane = 0) {
    const fallback = { 1: 'A', 2: 'S', 3: 'D', 4: 'F' };
    const r = root || this.getTranquilityRoot();
    let label = r ? this.session.mem.findChildByName(r, 'KeyLabel' + index) : 0;
    if (!label && lane) label = this.session.mem.findChildByName(lane, 'KeyLabel');
    if (label) {
      const keyText = this.session.mem.readGuiText(label).trim();
      if (keyText.length === 1) return keyText.toUpperCase();
    }
    return fallback[index] || '';
  }

  collectTranquilityLaneNotes(lane) {
    const notes = [];
    const seen = new Set();
    if (!lane) return notes;
    const mem = this.session.mem;

    const pushNote = (addr) => {
      if (!addr || seen.has(addr)) return;
      seen.add(addr);
      notes.push(addr);
    };

    for (const childAddr of mem.readChildren(lane)) {
      const childName = mem.readInstanceName(childAddr);
      const childClass = mem.readClassName(childAddr);

      if (isTranquilityNoteName(childName)) {
        if (childClass === 'ImageLabel') {
          pushNote(childAddr);
          continue;
        }
        if (childClass === 'Frame' || childClass === 'CanvasGroup') {
          let nestedNote = 0;
          for (const nestedAddr of mem.readChildren(childAddr)) {
            if (mem.readClassName(nestedAddr) !== 'ImageLabel') continue;
            const nestedName = mem.readInstanceName(nestedAddr);
            if (isTranquilityNoteName(nestedName) || !nestedNote) nestedNote = nestedAddr;
            if (isTranquilityNoteName(nestedName)) break;
          }
          pushNote(nestedNote || childAddr);
        }
        continue;
      }

      if (childClass !== 'Frame' && childClass !== 'CanvasGroup') continue;
      for (const nestedAddr of mem.readChildren(childAddr)) {
        if (mem.readClassName(nestedAddr) !== 'ImageLabel') continue;
        if (isTranquilityNoteName(mem.readInstanceName(nestedAddr))) pushNote(nestedAddr);
      }
    }

    return notes;
  }

  getMetronome() {
    const reelGui = this.getReelGui();
    if (!reelGui || !this.isReelGuiVisible(reelGui)) return 0;
    const bar = this.session.mem.findChildByName(reelGui, 'bar');
    if (!bar) return 0;
    const details = this.session.mem.findChildByName(bar, 'Details');
    return details ? this.session.mem.findChildByName(details, 'Metronome') : 0;
  }

  getMetronomeTicker(metronome = 0) {
    const m = metronome || this.getMetronome();
    return m ? this.session.mem.findChildByName(m, 'Ticker') : 0;
  }

  isMetronomeActive() {
    const ticker = this.getMetronomeTicker();
    return !!(ticker && this.session.mem.readGuiObjectVisible(ticker));
  }

  resolvePowerBarPath() {
    const mem = this.session.mem;
    if (mem.isCachedAddrValid(this.state.powerBarAddr, 'bar')) {
      return { bar: this.state.powerBarAddr };
    }

    this.state.powerBarAddr = 0;
    const workspace = this.session.getWorkspaceRoot();
    const localPlayer = this.session.getLocalPlayer();
    if (!workspace || !localPlayer) return { bar: 0 };

    const playerName = mem.readInstanceName(localPlayer);
    if (!playerName || playerName === '<null>') return { bar: 0 };

    const character = mem.findChildByName(workspace, playerName);
    if (!character) return { bar: 0 };
    const rootPart = mem.findChildByName(character, 'HumanoidRootPart');
    if (!rootPart) return { bar: 0 };
    const powerGui = mem.findChildByName(rootPart, 'power');
    if (!powerGui) return { bar: 0 };
    const bar = this.session.findDescendantFrameByName(powerGui, 'bar');
    if (!bar) return { bar: 0 };

    this.state.powerBarAddr = bar;
    return { bar };
  }

  readPowerBarPercent(instanceAddr) {
    const base = this.session.mem.offsets.FrameSizeX || 0;
    const scaleY = this.session.mem.readFloat(Number(instanceAddr) + base + 0x8);
    return clamp(scaleY * 100, 0, 100);
  }

  updateCastingPhase() {
    this.state.progressPercent = '';

    const preDelay = Number(this.settings.pre_cast_delay_ms) || 0;
    if (preDelay > 0 && this.now() - this.state.castStartedAt < preDelay) return;

    if (!this.state.isHolding) this.session.focusGame();
    this.holdMouse();
    if (!this.state.castStartedAt) this.state.castStartedAt = this.now();

    const resolved = this.resolvePowerBarPath();
    if (!resolved.bar) {
      this.state.powerPercent = '';
      if (this.now() - this.state.castStartedAt >= this.state.castWaitTimeoutMs) {
        this.state.castTimeoutCount += 1;
        if (this.settings.cast_on_timeout) this.startCycle();
        else this.stopCycle('OFF');
      }
      return;
    }

    this.state.castBarSeen = true;
    const percent = this.readPowerBarPercent(resolved.bar);
    this.state.powerPercent = percent.toFixed(1);

    if (percent >= this.state.castThreshold) {
      this.releaseMouse(true);
      this.state.castReleasedAt = this.now();
      this.state.phase = 'CASTED';
      return;
    }

    if (this.now() - this.state.castStartedAt >= this.state.castWaitTimeoutMs) {
      this.state.castTimeoutCount += 1;
      if (this.settings.cast_on_timeout) this.startCycle();
      else this.stopCycle('OFF');
    }
  }

  updateCastedPhase() {
    this.state.powerPercent = '';
    this.state.progressPercent = '';
    this.releaseMouse(true);

    if (!this.state.castReleasedAt) this.state.castReleasedAt = this.now();
    if (this.now() - this.state.castReleasedAt < (Number(this.settings.post_cast_delay_ms) || 150)) {
      return;
    }

    this.state.lastShakedAt = 0;
    this.state.phase = 'SHAKE';
  }

  findShakeButton() {
    const mem = this.session.mem;
    if (this.state.shakeButtonAddr) {
      try {
        const name = mem.readInstanceName(this.state.shakeButtonAddr).toLowerCase();
        const cls = mem.readClassName(this.state.shakeButtonAddr);
        if (name.includes('shake') || cls.includes('Button')) return this.state.shakeButtonAddr;
      } catch {
        this.state.shakeButtonAddr = 0;
      }
    }

    const playerGui = this.session.findPlayerGui();
    if (!playerGui) return 0;

    const queue = [playerGui];
    let index = 0;
    while (index < queue.length && index < 500) {
      const current = queue[index++];
      let name = '';
      let cls = '';
      try {
        name = mem.readInstanceName(current).toLowerCase();
        cls = mem.readClassName(current);
      } catch {
        continue;
      }

      if (
        index > 1 &&
        (name === 'backpack' ||
          name === 'hotbar' ||
          name === 'chat' ||
          name === 'playerlist' ||
          name.includes('inventory'))
      ) {
        continue;
      }

      const looksLikeShake =
        name === 'shake' || name === 'shakeui' || name === 'shakescreen' || name.includes('shake');
      if (looksLikeShake) {
        if (cls.includes('Button')) {
          this.state.shakeButtonAddr = current;
          return current;
        }
        for (const child of mem.readChildren(current)) {
          if (mem.readClassName(child).includes('Button')) {
            this.state.shakeButtonAddr = child;
            return child;
          }
        }
        this.state.shakeButtonAddr = current;
        return current;
      }

      for (const child of mem.readChildren(current)) queue.push(child);
    }
    return 0;
  }

  clickShakeButton(buttonAddr) {
    if (!buttonAddr) return false;
    const mem = this.session.mem;
    const pos = mem.readGuiVector2(buttonAddr, 'AbsolutePosition');
    const size = mem.readGuiVector2(buttonAddr, 'AbsoluteSize');
    if (!pos) return false;
    const w = size && size.X > 4 ? size.X : 80;
    const h = size && size.Y > 4 ? size.Y : 40;
    if (!this.session.hwnd) {
      this.session.hwnd = win32.findBestWindowForPid(this.session.pid);
    }
    return win32.clickClient(this.session.hwnd, pos.X + w / 2, pos.Y + h / 2);
  }

  performShakeAction() {
    this.ensureUiNavigation();
    this.session.focusGame();
    win32.tapEnter();
    const button = this.findShakeButton();
    if (button) this.clickShakeButton(button);
  }

  updateShakePhase() {
    this.state.powerPercent = '';
    this.state.progressPercent = '';
    this.releaseAllFishingMouse(true);

    const rod = this.session.rod;

    if (isTranquilityRodText(rod) && this.getTranquilityLaneContainer()) {
      this.state.lastShakedAt = 0;
      this.state.fishingLostAt = 0;
      this.state.phase = 'TRANQUILITY';
      return;
    }

    if (isLullabyRodText(rod) && this.isMetronomeActive()) {
      this.state.lastShakedAt = 0;
      this.state.fishingLostAt = 0;
      this.state.phase = 'LULLABY';
      return;
    }

    if (isBellonaRodText(rod)) {
      if (this.hasActiveBellonaContext() || this.hasActiveFishingContext()) {
        this.state.lastShakedAt = 0;
        this.state.fishingLostAt = 0;
        this.state.phase = 'BELLONA';
        return;
      }
    } else if (this.hasActiveFishingContext()) {
      this.state.lastShakedAt = 0;
      this.state.fishingLostAt = 0;
      this.state.shakeButtonAddr = 0;
      this.state.phase = 'FISHING';
      return;
    }

    if (!this.state.lastShakedAt || this.now() - this.state.lastShakedAt >= this.state.shakingIntervalMs) {
      this.performShakeAction();
      this.state.lastShakedAt = this.now();
    }

    if (
      this.state.castReleasedAt &&
      this.now() - this.state.castReleasedAt >= this.state.castWaitTimeoutMs
    ) {
      this.startCycle();
    }
  }

  updateFishingPhase() {
    this.state.powerPercent = '';

    const reelGuiVisible = this.isReelGuiVisible();
    let ctx = reelGuiVisible ? this.getReelBarContext() : null;

    const progress = this.getFishingCompletionPercent();
    this.state.progressPercent = progress == null ? '' : String(Math.round(progress));

    if (progress != null && progress >= Number(this.settings.completion_threshold)) {
      this.state.completionReached = true;
    }

    if (this.state.completionReached) {
      this.releaseMouse(true);
      this.controller.reset();
      if (reelGuiVisible) {
        this.state.fishingLostAt = 0;
        return;
      }
      ctx = null;
    }

    if (ctx) {
      this.state.fishingLostAt = 0;
      if (this.hasActiveFishingContext(ctx)) this.controller.update(ctx);
      else this.releaseMouse();
      return;
    }

    this.releaseMouse();
    this.controller.reset();

    if (!this.state.fishingLostAt) this.state.fishingLostAt = this.now();

    if (this.now() - this.state.fishingLostAt >= this.state.fishingEndGraceMs) {
      if (!this.state.outcomeResolved) {
        this.state.outcomeResolved = true;
        if (this.state.completionReached) this.state.fishCaughtCount += 1;
        else this.state.fishLostCount += 1;
      }
      this.stopCycle('DONE');
    }
  }

  updateBellonaPhase() {
    this.state.powerPercent = '';
    const threshold = Number(this.settings.completion_threshold) || 99.7;
    const contexts = this.getReelContexts();

    if (typeof this.controller.updateCompletionState === 'function') {
      this.controller.updateCompletionState(threshold);
    }

    const progress =
      typeof this.controller.getProgressPercent === 'function'
        ? this.controller.getProgressPercent()
        : null;
    this.state.progressPercent = progress == null ? '' : String(Math.round(progress));

    if (this.state.completionReached) {
      this.releaseAllFishingMouse(true);
      this.controller.reset();
      if (contexts.length > 0) {
        this.state.fishingLostAt = 0;
        return;
      }
    } else if (
      contexts.length > 0 &&
      typeof this.controller.hasActiveContext === 'function' &&
      this.controller.hasActiveContext()
    ) {
      this.state.fishingLostAt = 0;
      this.controller.update();
      return;
    }

    this.releaseAllFishingMouse();
    this.controller.reset();

    if (!this.state.fishingLostAt) this.state.fishingLostAt = this.now();
    if (this.now() - this.state.fishingLostAt >= this.state.fishingEndGraceMs) {
      if (!this.state.outcomeResolved) {
        this.state.outcomeResolved = true;
        if (this.state.completionReached) this.state.fishCaughtCount += 1;
        else this.state.fishLostCount += 1;
      }
      this.stopCycle('DONE');
    }
  }

  updateTranquilityPhase() {
    this.state.powerPercent = '';
    const root = this.getTranquilityRoot();
    const progress = this.readTranquilityProgressPercent(root);
    this.state.progressPercent = progress == null ? '' : String(Math.round(progress));

    if (progress != null && progress >= Number(this.settings.completion_threshold)) {
      this.state.completionReached = true;
    }

    const container = root ? this.getTranquilityLaneContainer(root) : 0;
    if (container) {
      this.state.fishingLostAt = 0;
      this.controller.update();
      return;
    }

    if (!this.state.fishingLostAt) this.state.fishingLostAt = this.now();
    if (this.now() - this.state.fishingLostAt >= this.state.fishingEndGraceMs) {
      if (!this.state.outcomeResolved) {
        this.state.outcomeResolved = true;
        if (this.state.completionReached) this.state.fishCaughtCount += 1;
        else this.state.fishLostCount += 1;
      }
      this.stopCycle('DONE');
    }
  }

  updateLullabyPhase() {
    this.state.powerPercent = '';
    const metronomeActive = this.isMetronomeActive();
    const progress = this.getFishingCompletionPercent();
    this.state.progressPercent = progress == null ? '' : String(Math.round(progress));

    if (progress != null && progress >= Number(this.settings.completion_threshold)) {
      this.state.completionReached = true;
    }

    if (this.state.completionReached) {
      this.controller.reset();
      if (metronomeActive) {
        this.state.fishingLostAt = 0;
        return;
      }
    } else if (metronomeActive) {
      this.state.fishingLostAt = 0;
      this.controller.update();
      return;
    }

    this.controller.reset();
    if (!this.state.fishingLostAt) this.state.fishingLostAt = this.now();
    if (this.now() - this.state.fishingLostAt >= this.state.fishingEndGraceMs) {
      if (!this.state.outcomeResolved) {
        this.state.outcomeResolved = true;
        if (this.state.completionReached) this.state.fishCaughtCount += 1;
        else this.state.fishLostCount += 1;
      }
      this.stopCycle('DONE');
    }
  }

  tick() {
    switch (this.state.phase) {
      case 'CASTING':
        this.updateCastingPhase();
        break;
      case 'CASTED':
        this.updateCastedPhase();
        break;
      case 'SHAKE':
        this.updateShakePhase();
        break;
      case 'FISHING':
        this.updateFishingPhase();
        break;
      case 'TRANQUILITY':
        this.updateTranquilityPhase();
        break;
      case 'LULLABY':
        this.updateLullabyPhase();
        break;
      case 'BELLONA':
        this.updateBellonaPhase();
        break;
      case 'APPRAISE':
        this.appraise.tick();
        break;
      case 'DONE':
        if (this.state.cycleEnabled) this.startCycle();
        else this.stopCycle('OFF');
        break;
      case 'FAILED':
        this.state.cycleEnabled = false;
        this.state.phase = 'OFF';
        break;
      default:
        break;
    }
  }

  getStatusSnapshot() {
    const caught = this.state.fishCaughtCount;
    const lost = this.state.fishLostCount;
    const total = caught + lost;
    const success = total ? ((caught / total) * 100).toFixed(1) + '%' : '0.0%';
    const rod = this.session.rod || 'Waiting for Roblox…';
    let phase = this.state.phase;
    if (phase === 'APPRAISE') phase = 'APPRAISE ' + (this.state.appraiseState || 'IDLE');

    return {
      phase,
      rawPhase: this.state.phase,
      appraiseState: this.state.appraiseState,
      appraiseStatus: this.appraise.statusMessage,
      cycleEnabled: this.state.cycleEnabled,
      power: this.state.powerPercent === '' ? '---' : this.state.powerPercent + '%',
      progress: this.state.progressPercent === '' ? '---' : this.state.progressPercent + '%',
      rod,
      rodKind: resolveRodKind(rod),
      attached: this.session.attached,
      pid: this.session.pid || 0,
      placeId: this.session.attached ? this.session.getPlaceId() : 0,
      offsetsVersion: this.session.offsetsVersion || '',
      caught,
      lost,
      success,
      castTimeouts: this.state.castTimeoutCount,
      autoAppraiseEnabled: !!this.settings.auto_appraise_enabled
    };
  }
}

module.exports = {
  FishingMacro,
  FishingController,
  defaultSettings
};
