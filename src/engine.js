/**
 * Macro engine: attach watcher + fishing/appraise tick loop + status events.
 * AGPL-3.0-only — see NOTICE / LICENSE.
 */
'use strict';

const { RobloxSession, FISCH_PLACE_ID } = require('./roblox');
const { FishingMacro, defaultSettings } = require('./fish');
const { toFriendlyError } = require('./friendlyErrors');
const { refreshOffsetsFromRemote } = require('./offsets');

class MacroEngine {
  constructor({ onStatus, isAutoFixEnabled } = {}) {
    this.session = new RobloxSession();
    this.macro = new FishingMacro(this.session);
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.isAutoFixEnabled =
      typeof isAutoFixEnabled === 'function' ? isAutoFixEnabled : () => true;
    this.tickTimer = null;
    this.watchTimer = null;
    this.lastError = '';
    this.running = false;
    this.loadingFailStreak = 0;
    /** @type {Promise<object> | null} */
    this.offsetHealPromise = null;
  }

  get settings() {
    return this.macro.settings;
  }

  setSettings(partial) {
    this.macro.applySettings(partial || {});
    this.emitStatus();
  }

  emitStatus(extra = {}) {
    const snap = this.macro.getStatusSnapshot();
    this.onStatus({
      ...snap,
      error: this.lastError,
      running: this.running,
      fischPlaceId: FISCH_PLACE_ID,
      ...extra
    });
  }

  startWatchers() {
    if (this.watchTimer) return;
    this.watchTimer = setInterval(() => this.watchTick(), 1500);
    this.watchTick();
  }

  stopWatchers() {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
  }

  watchTick() {
    try {
      const result = this.session.ensureReady({ attemptAttach: true });
      if (!result.ok) {
        const soft =
          result.code === 'not_in_fisch' ||
          result.code === 'loading' ||
          result.code === 'no_roblox';
        // Soft waiting states stay quiet in the UI; don't spam scary offset toasts.
        this.lastError = soft ? '' : toFriendlyError(result.error || '');
        if (this.running && !soft) this.stop('OFF');
        this.emitStatus({
          attachCode: result.code || '',
          waitingForRoblox: soft
        });
        this.maybeScheduleOffsetHeal(result.code || '');
        return;
      }

      this.loadingFailStreak = 0;
      this.lastError = '';
      try {
        this.session.refreshRod();
      } catch {
        // ignore
      }
      this.emitStatus({ attachCode: 'ok', waitingForRoblox: false });
    } catch (err) {
      this.lastError = toFriendlyError(err.message || String(err));
      if (this.running) this.stop('OFF');
      this.emitStatus();
    }
  }

  /**
   * When Roblox updates, local offsets go stale. Auto-download a fresh dump
   * (rate-limited) and re-attach without the user manually editing offsets.json.
   * @param {string} code
   */
  maybeScheduleOffsetHeal(code) {
    if (!this.isAutoFixEnabled()) return;
    if (code === 'no_roblox' || code === 'not_in_fisch') {
      this.loadingFailStreak = 0;
      return;
    }

    if (code === 'loading') {
      this.loadingFailStreak += 1;
      // ~4.5s of failed DataModel reads — likely stale offsets, not a slow join.
      if (this.loadingFailStreak < 3) return;
      this.scheduleOffsetHeal({ force: false, reason: 'loading' });
      return;
    }

    if (code === 'offsets' || code === 'attach_failed') {
      this.scheduleOffsetHeal({ force: true, reason: code });
    }
  }

  /**
   * @param {{ force?: boolean, reason?: string }} [options]
   */
  scheduleOffsetHeal(options = {}) {
    if (this.offsetHealPromise) return this.offsetHealPromise;

    this.offsetHealPromise = (async () => {
      const heal = await refreshOffsetsFromRemote({ force: !!options.force });
      if (!heal.ok) {
        this.emitStatus({
          attachCode: 'offsets',
          waitingForRoblox: false,
          offsetsHeal: {
            ok: false,
            reason: options.reason || '',
            error: heal.error || 'Could not download offsets.'
          }
        });
        return heal;
      }

      if (heal.updated) {
        this.session.detach();
        this.loadingFailStreak = 0;
        this.emitStatus({
          offsetsHeal: {
            ok: true,
            updated: true,
            version: heal.version,
            previous: heal.previous,
            reason: options.reason || ''
          }
        });
        // Retry attach with the fresh dump.
        this.watchTick();
      }
      return heal;
    })().finally(() => {
      this.offsetHealPromise = null;
    });

    return this.offsetHealPromise;
  }

  async fixRoblox() {
    this.session.detach();

    let heal = null;
    if (this.isAutoFixEnabled()) {
      heal = await refreshOffsetsFromRemote({ force: true });
      if (heal.ok && heal.updated) {
        this.emitStatus({
          offsetsHeal: {
            ok: true,
            updated: true,
            version: heal.version,
            previous: heal.previous,
            reason: 'fix_roblox'
          }
        });
      }
    }

    const result = this.session.ensureReady({ attemptAttach: true });
    if (!result.ok) {
      // One more heal attempt if attach still looks like bad offsets.
      if (
        this.isAutoFixEnabled() &&
        (result.code === 'offsets' || result.code === 'loading' || result.code === 'attach_failed')
      ) {
        heal = await refreshOffsetsFromRemote({ force: true });
        if (heal.ok) {
          this.session.detach();
          const retry = this.session.ensureReady({ attemptAttach: true });
          if (retry.ok) {
            this.lastError = '';
            this.loadingFailStreak = 0;
            this.session.refreshRod();
            this.emitStatus({
              attachCode: 'ok',
              offsetsHeal: heal.updated
                ? {
                    ok: true,
                    updated: true,
                    version: heal.version,
                    previous: heal.previous,
                    reason: 'fix_roblox'
                  }
                : undefined
            });
            return { ok: true, offsetsHeal: heal };
          }
        }
      }

      this.lastError = toFriendlyError(result.error || 'Attach failed');
      this.emitStatus();
      return { ok: false, error: this.lastError, offsetsHeal: heal };
    }

    this.lastError = '';
    this.loadingFailStreak = 0;
    this.session.refreshRod();
    this.emitStatus({ attachCode: 'ok' });
    return { ok: true, offsetsHeal: heal };
  }

  start() {
    return this.startFishing();
  }

  startFishing() {
    if (this.macro.state.phase === 'APPRAISE' && this.macro.state.cycleEnabled) {
      this.lastError = toFriendlyError('Appraise is on. Press {start_appraise} to stop it first.');
      this.emitStatus();
      return { ok: false, error: this.lastError };
    }

    const result = this.session.ensureReady({ attemptAttach: true });
    if (!result.ok) {
      this.lastError = toFriendlyError(result.error || 'Roblox is not ready yet. Open the game and try again.');
      this.emitStatus();
      return { ok: false, error: this.lastError };
    }

    this.lastError = '';
    this.session.focusGame();
    this.session.refreshRod();
    this.macro.startCycle();

    this.running = true;
    this.startTickLoop();
    this.emitStatus();
    return { ok: true };
  }

  startAppraise() {
    if (this.running && this.macro.state.phase !== 'APPRAISE') {
      this.lastError = toFriendlyError('Fishing is on. Press {start_macro} to stop it first.');
      this.emitStatus();
      return { ok: false, error: this.lastError };
    }

    if (!this.macro.appraise.isEnabled()) {
      this.lastError = toFriendlyError('Turn on auto appraise in the Appraise tab first.');
      this.emitStatus();
      return { ok: false, error: this.lastError };
    }

    const result = this.session.ensureReady({ attemptAttach: true });
    if (!result.ok) {
      this.lastError = toFriendlyError(result.error || 'Roblox is not ready yet. Open the game and try again.');
      this.emitStatus();
      return { ok: false, error: this.lastError };
    }

    this.lastError = '';
    this.session.focusGame();
    this.session.refreshRod();

    const appraiseResult = this.macro.appraise.start();
    if (!appraiseResult.ok) {
      const message = appraiseResult.error || this.macro.appraise.statusMessage;
      const failed = this.macro.state.appraiseState === 'FAILED';
      this.lastError = failed ? '' : toFriendlyError(message);
      this.running = false;
      this.emitStatus({ appraiseStatus: this.macro.appraise.statusMessage });
      return { ok: false, error: toFriendlyError(message) };
    }
    if (appraiseResult.alreadyHad) {
      this.running = false;
      this.emitStatus();
      return { ok: true, alreadyHad: true };
    }

    this.running = true;
    this.startTickLoop();
    this.emitStatus();
    return { ok: true };
  }

  stop(phase = 'OFF') {
    if (this.macro.state.phase === 'APPRAISE') {
      this.macro.appraise.stop('OFF', 'Stopped by hotkey.');
    } else {
      this.macro.stopCycle(phase);
    }
    this.running = false;
    this.stopTickLoop();
    this.emitStatus();
    return { ok: true };
  }

  stopAppraise() {
    if (this.macro.state.phase === 'APPRAISE' && this.macro.state.cycleEnabled) {
      this.macro.appraise.stop('OFF', 'Stopped by hotkey.');
      this.running = false;
      this.stopTickLoop();
      this.emitStatus();
      return { ok: true, stopped: true };
    }
    return { ok: true, stopped: false };
  }

  toggle() {
    if (this.macro.state.phase === 'APPRAISE' && this.macro.state.cycleEnabled) {
      this.lastError = toFriendlyError('Appraise is on. Press {start_appraise} to stop it first.');
      this.emitStatus();
      return { ok: false, error: this.lastError };
    }
    if (this.running || this.macro.state.cycleEnabled) {
      return this.stop('OFF');
    }
    return this.startFishing();
  }

  toggleAppraise() {
    if (this.macro.state.phase === 'APPRAISE' && this.macro.state.cycleEnabled) {
      return this.stopAppraise();
    }
    return this.startAppraise();
  }

  startTickLoop() {
    this.stopTickLoop();
    const rate = Math.max(1, Math.min(35, Number(this.macro.settings.update_rate) || 12));
    this.tickTimer = setInterval(() => this.tick(), rate);
  }

  stopTickLoop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  tick() {
    if (!this.macro.state.cycleEnabled && this.macro.state.phase === 'OFF') {
      this.running = false;
      this.stopTickLoop();
      this.emitStatus();
      return;
    }

    try {
      if (!this.session.attached) {
        const result = this.session.ensureReady({ attemptAttach: true });
        if (!result.ok) {
          this.lastError = toFriendlyError(result.error || '');
          this.stop('OFF');
          return;
        }
      }
      this.macro.tick();
      if (this.macro.state.phase === 'OFF' || this.macro.state.phase === 'FAILED') {
        if (this.macro.state.phase === 'FAILED') this.macro.state.phase = 'OFF';
        this.running = false;
        this.stopTickLoop();
      }
      if (this.macro.state.phase === 'DONE' && !this.macro.state.cycleEnabled) {
        this.macro.state.phase = 'OFF';
        this.running = false;
        this.stopTickLoop();
      }
      this.emitStatus();
    } catch (err) {
      this.lastError = toFriendlyError(err.message || String(err));
      this.stop('OFF');
    }
  }

  dispose() {
    this.stop('OFF');
    this.stopWatchers();
    this.session.detach();
  }

  getStatus() {
    return {
      ...this.macro.getStatusSnapshot(),
      error: this.lastError,
      running: this.running,
      fischPlaceId: FISCH_PLACE_ID
    };
  }
}

module.exports = {
  MacroEngine,
  defaultSettings,
  FISCH_PLACE_ID
};
