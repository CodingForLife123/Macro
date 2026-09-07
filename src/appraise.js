/**
 * Auto-appraise cycle — ported from OpenMacro XTernal Appraise.ahk.
 * AGPL-3.0-only — see NOTICE / LICENSE.
 */
'use strict';

const win32 = require('./win32');
const { toFriendlyError, toFriendlyStatus } = require('./friendlyErrors');
const { isFishingGearText } = require('./rods');

const APPRAISE_FIXED_RETRY_MS = 500;
const APPRAISE_SUBVALUES_MAX_RETRIES = 5;

function normalizeAppraiseText(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[^a-zA-Z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isAppraiseTextCapable(className) {
  return String(className || '').includes('Text') || String(className || '').includes('Value');
}

function namesEqual(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function mutationTextMatches(haystack, desiredMutation) {
  const desired = normalizeAppraiseText(desiredMutation);
  if (!desired) return false;
  if (haystack.includes(desired)) return true;

  const words = desired.split(' ').filter(Boolean);
  return words.length > 1 && words.every((word) => haystack.includes(word));
}

class AppraiseController {
  constructor(macro) {
    this.macro = macro;
    this.statusMessage = 'Ready.';
  }

  get state() {
    return this.macro.state;
  }

  get session() {
    return this.macro.session;
  }

  get settings() {
    return this.macro.settings;
  }

  setStatus(message) {
    this.statusMessage = toFriendlyStatus(message);
  }

  clearCache() {
    const st = this.state;
    st.appraiseSubvaluesAddr = 0;
    st.appraiseLastClickAt = 0;
    st.appraiseWaitStartedAt = 0;
    st.appraiseSubvaluesRetryCount = 0;
    st.appraiseSubvaluesLastRetryAt = 0;
    st.appraiseStartCoins = '';
    st.appraiseEndCoins = '';
    st.appraiseState = 'IDLE';
    st.appraiseLastError = '';
  }

  isEnabled() {
    return !!this.settings.auto_appraise_enabled;
  }

  hasClickPoint() {
    const x = this.settings.auto_appraise_click_x;
    const y = this.settings.auto_appraise_click_y;
    return (
      x !== '' &&
      x != null &&
      y !== '' &&
      y != null &&
      Number.isFinite(Number(x)) &&
      Number.isFinite(Number(y))
    );
  }

  isAnythingEquipped() {
    try {
      return !!this.session.getEquippedToolName();
    } catch {
      return false;
    }
  }

  getEquippedItemName() {
    try {
      return String(this.session.getEquippedToolName() || '').trim();
    } catch {
      return '';
    }
  }

  isFishEquipped() {
    const equippedName = this.getEquippedItemName();
    if (!equippedName) return false;
    if (isFishingGearText(equippedName)) return false;
    return true;
  }

  start() {
    const equippedName = this.getEquippedItemName();
    if (!equippedName) {
      this.setStatus('Hold a fish in your hand first!');
      return { ok: false, error: toFriendlyError('Hold a fish in your hand first!') };
    }

    if (!this.isFishEquipped()) {
      this.setStatus('Hold a fish in your hand first!');
      return { ok: false, error: toFriendlyError('Hold a fish in your hand first!') };
    }

    if (!this.hasClickPoint()) {
      this.setStatus('Pick a click spot in the Appraise tab first.');
      return { ok: false, error: toFriendlyError('Pick where to click in the Appraise tab first.') };
    }

    const desiredMutation = String(this.settings.auto_appraise_mutation || '').trim();
    if (!desiredMutation) {
      this.setStatus('Pick which mutation you want.');
      return { ok: false, error: toFriendlyError('Choose a desired mutation before starting.') };
    }

    this.macro.releaseAllFishingMouse(true);
    this.clearCache();

    this.state.phase = 'APPRAISE';
    this.state.appraiseState = 'RESOLVING';
    this.state.cycleEnabled = true;
    this.setStatus('Resolving fish info...');

    try {
      const subvaluesAddr = this.resolveFishInfoSubvalues();
      if (!subvaluesAddr) {
        throw new Error('Hold your fish in your hand, then try appraise again.');
      }

      this.state.appraiseStartCoins = this.readCurrentAppraiseCoins();

      if (this.hasDesiredMutation(desiredMutation)) {
        this.state.cycleEnabled = false;
        this.state.phase = 'DONE';
        this.state.appraiseState = 'DONE';
        this.setStatus(desiredMutation + ' mutation was already present.');
        return { ok: true, alreadyHad: true };
      }

      this.state.appraiseState = 'CLICK_FIRST';
      this.setStatus('Ready.');
      return { ok: true };
    } catch (err) {
      const friendly = toFriendlyError(err.message || String(err));
      this.fail(friendly);
      return { ok: false, error: friendly };
    }
  }

  stop(nextPhase = 'OFF', status = 'Stopped.') {
    this.macro.releaseAllFishingMouse(true);
    this.state.cycleEnabled = false;
    this.state.phase = nextPhase;
    if (nextPhase === 'OFF') this.clearCache();
    else this.state.appraiseState = nextPhase;
    this.setStatus(status);
  }

  fail(message) {
    const friendly = toFriendlyError(message);
    this.state.appraiseEndCoins = this.readCurrentAppraiseCoins();
    this.state.cycleEnabled = false;
    this.state.appraiseState = 'FAILED';
    this.state.appraiseLastError = friendly;
    this.state.phase = 'FAILED';
    this.setStatus(friendly);
  }

  complete(status) {
    this.state.appraiseEndCoins = this.readCurrentAppraiseCoins();
    this.state.cycleEnabled = false;
    this.state.appraiseState = 'DONE';
    this.state.phase = 'DONE';
    this.setStatus(status);
  }

  tick() {
    const st = this.state;
    const delay = Math.max(0, Number(this.settings.appraise_delay_ms) || 100);
    const desiredMutation = String(this.settings.auto_appraise_mutation || '').trim();
    const now = Date.now();

    switch (st.appraiseState) {
      case 'CLICK_FIRST':
        this.setStatus('Clicking 1/2.');
        this.clickAppraisePoint();
        st.appraiseLastClickAt = now;
        st.appraiseState = 'CLICK_SECOND';
        break;

      case 'CLICK_SECOND':
        if (now - st.appraiseLastClickAt < delay) return;
        this.setStatus('Clicking 2/2.');
        this.clickAppraisePoint();
        st.appraiseLastClickAt = now;
        st.appraiseWaitStartedAt = now;
        st.appraiseSubvaluesLastRetryAt = now;
        st.appraiseState = 'WAIT_RESULT';
        break;

      case 'WAIT_RESULT':
        try {
          if (this.hasDesiredMutation(desiredMutation)) {
            this.complete('Found ' + desiredMutation + '.');
            return;
          }
        } catch (err) {
          const msg = err.message || String(err);
          if (msg.includes('Subvalues') || msg.includes('fishinfo') || msg.includes('Workspace')) {
            if (
              st.appraiseSubvaluesLastRetryAt &&
              now - st.appraiseSubvaluesLastRetryAt < APPRAISE_FIXED_RETRY_MS
            ) {
              return;
            }
            st.appraiseSubvaluesLastRetryAt = now;
            st.appraiseSubvaluesRetryCount += 1;
            if (st.appraiseSubvaluesRetryCount <= APPRAISE_SUBVALUES_MAX_RETRIES) {
              this.setStatus(
                'Waiting for fish info... ' +
                  st.appraiseSubvaluesRetryCount +
                  '/' +
                  APPRAISE_SUBVALUES_MAX_RETRIES
              );
              return;
            }
          }
          this.fail(toFriendlyError(msg));
          return;
        }

        st.appraiseSubvaluesRetryCount = 0;
        st.appraiseSubvaluesLastRetryAt = 0;
        this.setStatus('Still looking for ' + desiredMutation + '.');
        st.appraiseWaitStartedAt = now;
        st.appraiseState = 'WAIT_RETRY';
        break;

      case 'WAIT_RETRY':
        if (now - st.appraiseWaitStartedAt < delay) return;
        this.setStatus('Retrying.');
        st.appraiseWaitStartedAt = 0;
        st.appraiseState = 'CLICK_FIRST';
        break;

      default:
        break;
    }
  }

  findDescendantByName(rootAddr, targetName, maxNodes = 400) {
    const mem = this.session.mem;
    if (!rootAddr) return 0;
    const queue = [rootAddr];
    let index = 0;
    while (index < queue.length && index < maxNodes) {
      const current = queue[index++];
      if (namesEqual(mem.readInstanceName(current), targetName)) {
        return current;
      }
      for (const child of mem.readChildren(current)) queue.push(child);
    }
    return 0;
  }

  resolveFishInfoSubvalues() {
    const mem = this.session.mem;
    const character = this.session.getCharacterModel();
    if (!character) {
      this.state.appraiseSubvaluesAddr = 0;
      return 0;
    }

    const fishInfo = mem.findChildByName(character, 'fishinfo');
    const fishInfoDesc = fishInfo || this.findDescendantByName(character, 'fishinfo', 600);
    if (!fishInfoDesc) {
      this.state.appraiseSubvaluesAddr = 0;
      return 0;
    }

    const info = mem.findChildByName(fishInfoDesc, 'Info') || this.findDescendantByName(fishInfoDesc, 'Info', 250);
    if (!info) {
      this.state.appraiseSubvaluesAddr = 0;
      return 0;
    }

    const subvalues =
      mem.findChildByName(info, 'Subvalues') || this.findDescendantByName(info, 'Subvalues', 250);
    this.state.appraiseSubvaluesAddr = subvalues || 0;
    return subvalues || 0;
  }

  hasDesiredMutation(desiredMutation) {
    const equippedName = normalizeAppraiseText(this.getEquippedItemName());
    if (equippedName && mutationTextMatches(equippedName, desiredMutation)) {
      return true;
    }

    const subvaluesAddr = this.resolveFishInfoSubvalues();
    if (!subvaluesAddr) {
      const guiHaystack = normalizeAppraiseText(this.collectVisiblePlayerGuiText());
      if (guiHaystack.includes('appraised') && mutationTextMatches(guiHaystack, desiredMutation)) {
        return true;
      }
      throw new Error('Hold your fish in your hand, then try appraise again.');
    }

    const haystack = normalizeAppraiseText(this.collectSubvaluesText(subvaluesAddr));
    if (mutationTextMatches(haystack, desiredMutation)) return true;

    const guiHaystack = normalizeAppraiseText(this.collectVisiblePlayerGuiText());
    return guiHaystack.includes('appraised') && mutationTextMatches(guiHaystack, desiredMutation);
  }

  collectSubvaluesText(subvaluesAddr) {
    const parts = [];
    const mem = this.session.mem;
    const queue = [subvaluesAddr];
    let index = 0;
    while (index < queue.length && index < 400) {
      const current = queue[index++];
      this.appendNodeText(parts, current);
      for (const child of mem.readChildren(current)) queue.push(child);
    }
    return parts.join(' ');
  }

  appendNodeText(parts, instanceAddr) {
    try {
      const mem = this.session.mem;
      const className = mem.readClassName(instanceAddr);
      if (!isAppraiseTextCapable(className)) return;

      let text = mem.readGuiText(instanceAddr);
      if (!text && className.includes('Value') && mem.offsets.Value != null) {
        const ptr = mem.readPointer(Number(instanceAddr) + mem.offsets.Value);
        if (ptr) text = mem.readString(ptr);
        if (!text) text = mem.readString(Number(instanceAddr) + mem.offsets.Value);
      }
      text = String(text || '').trim();
      if (text) parts.push(text);
    } catch {
      // ignore
    }
  }

  collectVisiblePlayerGuiText() {
    const playerGui = this.session.findPlayerGui();
    if (!playerGui) return '';

    const mem = this.session.mem;
    const parts = [];
    const queue = [playerGui];
    let index = 0;
    while (index < queue.length && index < 800) {
      const current = queue[index++];
      try {
        const className = mem.readClassName(current);
        if (isAppraiseTextCapable(className) && mem.readGuiObjectVisible(current)) {
          this.appendNodeText(parts, current);
        }
      } catch {
        // ignore
      }
      for (const child of mem.readChildren(current)) queue.push(child);
    }
    return parts.join(' ');
  }

  readCurrentAppraiseCoins() {
    try {
      const playerGui = this.session.findPlayerGui();
      if (!playerGui) return '';
      const mem = this.session.mem;
      const hud = mem.findChildByName(playerGui, 'hud');
      if (!hud) return '';
      const safezone = mem.findChildByName(hud, 'safezone');
      if (!safezone) return '';
      const coins = mem.findChildByName(safezone, 'coins');
      if (!coins) return '';
      const digits = String(mem.readGuiText(coins) || '').replace(/\D/g, '');
      return digits ? Number(digits) : '';
    } catch {
      return '';
    }
  }

  clickAppraisePoint() {
    const x = Math.round(Number(this.settings.auto_appraise_click_x));
    const y = Math.round(Number(this.settings.auto_appraise_click_y));
    win32.reliableScreenClick(x, y);
  }
}

module.exports = {
  AppraiseController,
  normalizeAppraiseText
};
