/**
 * Fishing controllers — ported from OpenMacro XTernal Fish.ahk.
 * AGPL-3.0-only — see NOTICE / LICENSE.
 */
'use strict';

const win32 = require('./win32');
const { isDreambreakerRodText, isRequiemRodText } = require('./rods');

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function isReasonableGuiScale(value) {
  return value > -5.0 && value < 5.0;
}

function isTranquilityNoteName(name) {
  const n = String(name || '')
    .trim()
    .toLowerCase();
  switch (n) {
    case 'note':
    case 'slash':
    case 'stab':
    case 'freeze':
    case 'pierce':
    case 'slashnote':
    case 'stabnote':
    case 'freezenote':
    case 'piercenote':
    case 'specialnote':
    case 'bonusnote':
      return true;
    default:
      return /^(slash|stab|freeze|pierce)?_?notes?\d*$/i.test(n);
  }
}

function lullabyWindowsFor(mode) {
  switch (String(mode || '')
    .trim()
    .toLowerCase()) {
    case 'quickening':
      return [[0.0, 90.0]];
    case 'strengthening':
    case 'strenghtening':
      return [[76.0, 104.0]];
    case 'fortuitous':
      return [[90.0, 180.0]];
    case 'prismatic':
    case 'prismatic/serenity':
    case 'serenity':
      return [
        [0.0, 20.0],
        [160.0, 180.0]
      ];
    case 'resistant':
      return [
        [0.0, 20.0],
        [76.0, 104.0],
        [160.0, 180.0]
      ];
    default:
      return [];
  }
}

function lullabyInAnyWindow(rotation, windows) {
  if (rotation == null || Number.isNaN(rotation)) return false;
  for (const [lo, hi] of windows) {
    if (rotation >= lo && rotation <= hi) return true;
  }
  return false;
}

class FishingController {
  constructor(macro, button = 'LButton') {
    this.macro = macro;
    this.button = button;
    this.lastPlayerbarPos = null;
    this.lastFishPos = null;
    this.pwmAccumulator = 0;
  }

  reset() {
    this.lastPlayerbarPos = null;
    this.lastFishPos = null;
    this.pwmAccumulator = 0;
  }

  getFishPosition(ctx) {
    if (!ctx || !ctx.fish) return null;
    const fishPos = this.macro.session.mem.readFramePosition(ctx.fish);
    const fishSize = this.macro.session.mem.readFrameSize(ctx.fish);
    return fishPos.X + fishSize.X / 2;
  }

  getPlayerbarPosition(ctx) {
    if (!ctx || !ctx.playerbar) return null;
    return this.macro.session.mem.readFramePosition(ctx.playerbar).X;
  }

  isInverted() {
    if (!isDreambreakerRodText(this.macro.session.rod)) return false;
    const progress = this.macro.getFishingCompletionPercent();
    if (progress == null) return false;
    return progress >= 40.0;
  }

  hold() {
    if (this.button === 'RButton') {
      if (this.isInverted()) this.macro.releaseRightMouse();
      else this.macro.holdRightMouse();
      return;
    }
    if (this.isInverted()) this.macro.releaseMouse();
    else this.macro.holdMouse();
  }

  release() {
    if (this.button === 'RButton') {
      if (this.isInverted()) this.macro.holdRightMouse();
      else this.macro.releaseRightMouse();
      return;
    }
    if (this.isInverted()) this.macro.holdMouse();
    else this.macro.releaseMouse();
  }

  update(ctx) {
    const settings = this.macro.settings;
    const fishPos = this.getFishPosition(ctx);
    const playerbarPos = this.getPlayerbarPosition(ctx);
    if (fishPos == null || playerbarPos == null) return;

    if (this.lastPlayerbarPos == null) this.lastPlayerbarPos = playerbarPos;
    if (this.lastFishPos == null) this.lastFishPos = fishPos;

    const playerbarVelocity = playerbarPos - this.lastPlayerbarPos;
    this.lastPlayerbarPos = playerbarPos;

    const fishVelocity = fishPos - this.lastFishPos;
    this.lastFishPos = fishPos;

    const error = fishPos - playerbarPos;
    const edgeBoundary = settings.edge_boundary;

    if (playerbarPos < edgeBoundary) {
      this.hold();
      return;
    }
    if (playerbarPos > 1 - edgeBoundary) {
      this.release();
      return;
    }

    const predictionScale = settings.prediction_strength;
    const predicted = playerbarPos + playerbarVelocity * predictionScale;
    const predictedError = fishPos - predicted;

    const closeThreshold = settings.close_threshold;
    const sameSideAfterPrediction = error * predictedError > 0;
    const approachingTarget = error * playerbarVelocity > 0;
    const remainingDistance = Math.max(0, Math.abs(error) - closeThreshold);

    const brakeLookahead = Math.abs(playerbarVelocity) * 8;
    const needsPreSlow = approachingTarget && brakeLookahead >= remainingDistance;

    if (Math.abs(error) > closeThreshold && sameSideAfterPrediction && !needsPreSlow) {
      if (error > 0) this.hold();
      else this.release();
      return;
    }

    const neutralDuty = settings.neutral_duty_cycle;
    let targetDuty;

    if (needsPreSlow && brakeLookahead > 0) {
      const brakeUrgency = 1.0 - Math.min(1.0, remainingDistance / brakeLookahead);
      if (error > 0) targetDuty = neutralDuty * (1.0 - brakeUrgency);
      else targetDuty = neutralDuty + (1.0 - neutralDuty) * brakeUrgency;
    } else {
      const kP = settings.proportional_gain;
      const kD = settings.derivative_gain;
      const kV = settings.velocity_damping;
      const adjustment = kP * error + kD * fishVelocity - kV * playerbarVelocity;
      targetDuty = clamp(neutralDuty + adjustment, 0, 1);
    }

    this.pwmAccumulator += targetDuty;
    if (this.pwmAccumulator >= 1.0) {
      this.pwmAccumulator -= 1.0;
      this.hold();
    } else {
      this.release();
    }
  }
}

class RequiemController extends FishingController {
  // Timing quirk handled by FishingMacro.effectiveActionDelayMs()
}

class PinionController extends FishingController {
  static NOTE_DEADZONE = -16.5;

  constructor(macro, button = 'LButton') {
    super(macro, button);
    this.notesCaught = 0;
    this.noteCounted = false;
    this.resonanceActive = false;
  }

  reset() {
    super.reset();
    this.notesCaught = 0;
    this.noteCounted = false;
    this.resonanceActive = false;
  }

  getBothTargets(fishX, noteX, halfWidth) {
    const distance = Math.abs(noteX - fishX);
    const fullWidth = halfWidth * 2;
    if (distance > fullWidth) return null;
    if (distance <= halfWidth) return fishX;
    return noteX > fishX ? noteX - halfWidth : noteX + halfWidth;
  }

  getNoteDeadzone(playerbarX, fishX, noteX) {
    const playerToNoteDistance = Math.abs(noteX - playerbarX);
    const fishToNoteDistance = Math.abs(noteX - fishX);
    const dz =
      PinionController.NOTE_DEADZONE -
      playerToNoteDistance * 30.0 -
      fishToNoteDistance * 10.0;
    return Math.max(-22, Math.min(PinionController.NOTE_DEADZONE, dz));
  }

  updateNoteCount(note, ctx) {
    if (!this.noteCounted && note.sy >= -0.8 && note.sy <= 0.53) {
      if (this.macro.isNoteInPlayerBar(note.sx, ctx, 0.1)) {
        this.noteCounted = true;
        this.notesCaught += 1;
      } else {
        this.notesCaught = 0;
        this.resonanceActive = false;
        this.noteCounted = true;
      }
    }
    if (note.sy < -8) this.noteCounted = false;
    if (this.notesCaught >= 7) this.resonanceActive = true;
  }

  getFishPosition(ctx) {
    const fishX = super.getFishPosition(ctx);
    if (!ctx || !ctx.playerbar) return fishX;

    const playerbarSize = this.macro.session.mem.readFrameSize(ctx.playerbar);
    const halfWidth = playerbarSize.X / 2;
    const playerbarX = this.getPlayerbarPosition(ctx);
    if (playerbarX == null) return fishX;

    const note = this.macro.getActiveNoteTarget();
    if (!note) return fishX;

    if (this.resonanceActive) return note.sx;

    this.updateNoteCount(note, ctx);

    const activeDeadzone = this.getNoteDeadzone(playerbarX, fishX, note.sx);
    if (note.sy <= activeDeadzone) return fishX;

    const bothCatch = this.getBothTargets(fishX, note.sx, halfWidth);
    if (bothCatch != null) return bothCatch;
    return note.sx;
  }
}

class BellonaController {
  constructor(macro) {
    this.macro = macro;
    this.left = new FishingController(macro, 'LButton');
    this.right = new FishingController(macro, 'RButton');
  }

  reset() {
    this.left.reset();
    this.right.reset();
    this.macro.releaseAllFishingMouse(true);
  }

  getSideContexts() {
    const contexts = this.macro.getReelContexts();
    let leftCtx = null;
    let rightCtx = null;

    if (contexts.length >= 2) {
      leftCtx = contexts[0];
      rightCtx = contexts[contexts.length - 1];
    } else if (contexts.length === 1) {
      if (contexts[0].barX < 0.5) leftCtx = contexts[0];
      else rightCtx = contexts[0];
    }

    return { left: leftCtx, right: rightCtx };
  }

  hasActiveContext() {
    for (const ctx of this.macro.getReelContexts()) {
      if (ctx && ctx.fish && ctx.playerbar) return true;
    }
    return false;
  }

  getProgressPercent() {
    const values = [];
    for (const ctx of this.macro.getReelContexts()) {
      const progress = this.macro.readReelCompletionPercent(ctx);
      if (progress != null) values.push(progress);
    }
    if (!values.length) return null;
    return Math.min(...values);
  }

  updateCompletionState(threshold) {
    const sides = this.getSideContexts();
    const st = this.macro.state;

    if (sides.left) {
      const leftProgress = this.macro.readReelCompletionPercent(sides.left);
      if (leftProgress != null && leftProgress >= threshold) {
        st.bellonaLeftCompletionReached = true;
      }
    }
    if (sides.right) {
      const rightProgress = this.macro.readReelCompletionPercent(sides.right);
      if (rightProgress != null && rightProgress >= threshold) {
        st.bellonaRightCompletionReached = true;
      }
    }

    st.completionReached = !!(st.bellonaLeftCompletionReached && st.bellonaRightCompletionReached);
  }

  update() {
    const sides = this.getSideContexts();

    if (sides.left && sides.left.fish && sides.left.playerbar) {
      this.left.update(sides.left);
    } else {
      this.left.reset();
      this.macro.releaseMouse(true);
    }

    if (sides.right && sides.right.fish && sides.right.playerbar) {
      this.right.update(sides.right);
    } else {
      this.right.reset();
      this.macro.releaseRightMouse(true);
    }
  }
}

class TranquilityController {
  static HIT_Y_MIN = 0.825;
  static HIT_Y_MAX = 0.865;
  static RECEPTOR_Y = 0.845;
  static KEY_COOLDOWN_MS = 12;

  constructor(macro) {
    this.macro = macro;
    this.hitNotes = new Map();
    this.lastKeySentAt = new Map();
    this.lastNoteY = new Map();
  }

  reset() {
    this.macro.releaseMouse(true);
    this.hitNotes = new Map();
    this.lastKeySentAt = new Map();
    this.lastNoteY = new Map();
  }

  update() {
    this.macro.releaseMouse(true);
    const root = this.macro.getTranquilityRoot();
    if (!root) return;
    const container = this.macro.getTranquilityLaneContainer(root);
    if (!container) return;

    const mem = this.macro.session.mem;
    const seenNotes = new Set();

    for (let i = 1; i <= 4; i++) {
      const lane = this.macro.getTranquilityLane(i, container);
      if (!lane || !mem.readGuiObjectVisible(lane)) continue;

      const key = this.macro.getTranquilityLaneKey(i, root, lane);
      if (!key) continue;

      let bestAddr = 0;
      let bestRank = -1;
      let bestDist = 999999;

      for (const noteAddr of this.macro.collectTranquilityLaneNotes(lane)) {
        seenNotes.add(noteAddr);
        if (this.hitNotes.has(noteAddr) || !mem.readGuiObjectVisible(noteAddr)) continue;

        const pos = mem.readNotePosition(noteAddr);
        if (!isReasonableGuiScale(pos.sy)) continue;

        const sy = pos.sy;
        const lastY = this.lastNoteY.has(noteAddr) ? this.lastNoteY.get(noteAddr) : null;
        this.lastNoteY.set(noteAddr, sy);

        const inWindow = sy >= TranquilityController.HIT_Y_MIN && sy <= TranquilityController.HIT_Y_MAX;
        const crossed =
          lastY != null && lastY < TranquilityController.RECEPTOR_Y && sy >= TranquilityController.RECEPTOR_Y;
        const overshot =
          lastY != null &&
          lastY >= TranquilityController.HIT_Y_MIN &&
          lastY <= TranquilityController.HIT_Y_MAX &&
          sy > TranquilityController.HIT_Y_MAX;

        if (!(inWindow || crossed || overshot)) continue;

        const rank = crossed ? 3 : inWindow ? 2 : 1;
        const dist = Math.abs(sy - TranquilityController.RECEPTOR_Y);
        if (rank > bestRank || (rank === bestRank && dist < bestDist)) {
          bestRank = rank;
          bestDist = dist;
          bestAddr = noteAddr;
        }
      }

      if (bestAddr) this.pressLaneKey(key, bestAddr);
    }

    for (const noteAddr of [...this.hitNotes.keys()]) {
      if (!seenNotes.has(noteAddr)) this.hitNotes.delete(noteAddr);
    }
    for (const noteAddr of [...this.lastNoteY.keys()]) {
      if (!seenNotes.has(noteAddr)) this.lastNoteY.delete(noteAddr);
    }
  }

  pressLaneKey(key, noteAddr) {
    const now = Date.now();
    const lastSentAt = this.lastKeySentAt.get(key) || 0;
    if (
      TranquilityController.KEY_COOLDOWN_MS > 0 &&
      lastSentAt &&
      now - lastSentAt < TranquilityController.KEY_COOLDOWN_MS
    ) {
      return false;
    }

    this.macro.session.focusGame();
    win32.tapCharKey(key);
    this.lastKeySentAt.set(key, now);
    this.hitNotes.set(noteAddr, now);
    return true;
  }
}

class LullabyController {
  static CLICK_HOLD_MS = 30;

  constructor(macro) {
    this.macro = macro;
    this.clickedThisPass = false;
    this._clickUntil = 0;
  }

  reset() {
    this.macro.releaseMouse(true);
    this.clickedThisPass = false;
    this._clickUntil = 0;
  }

  update() {
    const now = Date.now();
    if (this._clickUntil && now < this._clickUntil) return;
    if (this._clickUntil && now >= this._clickUntil) {
      this.macro.releaseMouse(true);
      this._clickUntil = 0;
    }

    const ticker = this.macro.getMetronomeTicker();
    if (!ticker) {
      this.clickedThisPass = false;
      return;
    }

    const rotation = this.macro.session.mem.readFrameRotation(ticker);
    const windows = lullabyWindowsFor(this.macro.settings.lullaby_mode);
    if (!lullabyInAnyWindow(rotation, windows)) {
      this.clickedThisPass = false;
      return;
    }

    if (this.clickedThisPass) return;

    this.macro.session.focusGame();
    this.macro.holdMouse(true);
    this._clickUntil = now + LullabyController.CLICK_HOLD_MS;
    this.clickedThisPass = true;
  }
}

function createControllerForRod(macro, rodText) {
  const { resolveRodKind } = require('./rods');
  switch (resolveRodKind(rodText)) {
    case 'tranquility':
      return new TranquilityController(macro);
    case 'lullaby':
      return new LullabyController(macro);
    case 'pinion':
      return new PinionController(macro);
    case 'bellona':
      return new BellonaController(macro);
    case 'requiem':
      return new RequiemController(macro);
    case 'dreambreaker':
      return new FishingController(macro); // invert handled in FishingController
    default:
      return new FishingController(macro);
  }
}

module.exports = {
  FishingController,
  RequiemController,
  PinionController,
  BellonaController,
  TranquilityController,
  LullabyController,
  createControllerForRod,
  isTranquilityNoteName,
  lullabyWindowsFor,
  isRequiemRodText
};
