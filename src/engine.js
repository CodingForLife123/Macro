/**
 * Macro engine: attach watcher + fishing/appraise tick loop + status events.
 * AGPL-3.0-only — see NOTICE / LICENSE.
 */
'use strict';

const { RobloxSession, FISCH_PLACE_ID } = require('./roblox');
const { FishingMacro, defaultSettings } = require('./fish');
const { toFriendlyError } = require('./friendlyErrors');
const { refreshOffsetsFromRemote } = require('./offsets');
const { log } = require('./logger');
const { resolveGearType } = require('./rods');
const { HarpoonCatchWatcher } = require('./harpoon');

class MacroEngine {
  constructor({ onStatus, isAutoFixEnabled } = {}) {
    this.session = new RobloxSession();
    this.macro = new FishingMacro(this.session);
    this.harpoonWatcher = new HarpoonCatchWatcher(this.session);
    this.onStatus = typeof onStatus === 'function' ? onStatus : () => {};
    this.isAutoFixEnabled =
      typeof isAutoFixEnabled === 'function' ? isAutoFixEnabled : () => true;
    this.tickTimer = null;
    this.watchTimer = null;
    this.castWatchTimer = null;
    this.lastError = '';
    this.running = false;
    this.loadingFailStreak = 0;
    /** @type {Promise<object> | null} */
    this.offsetHealPromise = null;
    this._lastLoggedPhase = '';
    this._lastLoggedAttach = null;
    this._lastLoggedRod = '';
    this._lastLoggedEquippedRod = '';
    this._lastLoggedEquippedKind = '';
    this._lastLoggedCaught = 0;
    this._lastLoggedLost = 0;
    this._lastLoggedError = '';
    this._lastLoggedCasting = null;
    this._lastCatchSource = '';
    this._lastLoggedHarpoonPull = false;
    this._lastEquipPollAt = 0;
    this._lastHarpoonPollAt = 0;
    this._lastCastPollAt = 0;
    this._lastActivityTickAt = 0;
  }

  get settings() {
    return this.macro.settings;
  }

  setSettings(partial) {
    this.macro.applySettings(partial || {});
    if (partial && (partial.cast_mode != null || partial.cast_power_custom != null)) {
      const mode = this.macro.settings.cast_mode;
      const power = this.macro.settings.cast_power_custom;
      log.info(`Cast settings: mode=${mode} power=${power}%`);
    }
    this.emitStatus();
  }

  emitStatus(extra = {}) {
    const snap = this.macro.getStatusSnapshot();
    const harpoonCaught = this.harpoonWatcher.caughtCount || 0;
    const rodCaught = Number(snap.caught) || 0;
    const status = {
      ...snap,
      rodCaught,
      harpoonCaught,
      caught: rodCaught + harpoonCaught,
      harpoonPullActive: this.harpoonWatcher.phase === 'pull',
      error: this.lastError,
      running: this.running,
      fischPlaceId: FISCH_PLACE_ID,
      ...extra
    };
    this.onStatus(status);
    this.logStatusChanges(status, extra);
  }

  logStatusChanges(snap, extra = {}) {
    const attached = !!snap.attached;
    if (this._lastLoggedAttach !== attached) {
      this._lastLoggedAttach = attached;
      if (attached) {
        log.info(`Roblox attached (pid ${snap.pid || '?'})`);
      } else {
        const code = extra.attachCode ? ` (${extra.attachCode})` : '';
        log.warn(`Roblox not attached${code}`);
      }
    }

    const equippedRod = String(snap.equippedRod || '');
    const equippedKind =
      String(snap.equippedKind || '') || resolveGearType(equippedRod) || 'rod';
    if (equippedRod !== this._lastLoggedEquippedRod) {
      const prev = this._lastLoggedEquippedRod;
      const prevKind = this._lastLoggedEquippedKind || resolveGearType(prev) || 'rod';
      this._lastLoggedEquippedRod = equippedRod;
      this._lastLoggedEquippedKind = equippedRod ? equippedKind : '';
      if (equippedRod) {
        if (prev) {
          log.info(`Switched ${prevKind} → ${equippedKind}: ${equippedRod}`);
        } else {
          log.info(`Equipped ${equippedKind}: ${equippedRod}`);
        }
      } else if (prev) {
        log.info(`Unequipped ${prevKind} (${prev})`);
      }
    }

    const rod = String(snap.rod || '');
    if (rod && rod !== this._lastLoggedRod && rod.indexOf('Waiting') !== 0) {
      this._lastLoggedRod = rod;
    }

    const casting = !!snap.playerCasting;
    if (this._lastLoggedCasting === null) {
      this._lastLoggedCasting = casting;
    } else if (this._lastLoggedCasting !== casting) {
      this._lastLoggedCasting = casting;
      if (casting) {
        const castRod =
          String(snap.equippedRod || '').trim() ||
          (rod && rod.indexOf('Waiting') !== 0 ? rod : 'rod');
        log.info(`Casting ${castRod}`);
      }
    }

    if (extra.harpoonPullStarted) {
      log.info('Harpoon pull started');
    }

    const phase = String(snap.rawPhase || snap.phase || 'OFF');
    if (phase !== this._lastLoggedPhase) {
      this._lastLoggedPhase = phase;
      // Casting is logged via playerCasting above — skip noisy CASTING/CASTED lines
      if (phase !== 'CASTING' && phase !== 'CASTED') {
        log.info(`Phase → ${phase}`);
      }
    }

    const caught = Number(snap.caught) || 0;
    if (caught > this._lastLoggedCaught) {
      const via =
        extra.lastCatchSource === 'harpoon' || this._lastCatchSource === 'harpoon'
          ? ' with harpoon'
          : '';
      log.info(`Fish caught${via} (total ${caught})`);
      this._lastLoggedCaught = caught;
      this._lastCatchSource = '';
    } else {
      this._lastLoggedCaught = caught;
    }

    const lost = Number(snap.lost) || 0;
    if (lost > this._lastLoggedLost) {
      log.warn(`Fish lost (total ${lost})`);
      this._lastLoggedLost = lost;
    } else {
      this._lastLoggedLost = lost;
    }

    if (this.lastError && this.lastError !== this._lastLoggedError) {
      this._lastLoggedError = this.lastError;
      log.error(this.lastError);
    } else if (!this.lastError) {
      this._lastLoggedError = '';
    }
  }

  startWatchers() {
    if (this.watchTimer) return;
    this.watchTimer = setInterval(() => this.watchTick(), 2000);
    this.castWatchTimer = setInterval(() => this.activityWatchTick(), 100);
    this.watchTick();
  }

  stopWatchers() {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
    if (this.castWatchTimer) {
      clearInterval(this.castWatchTimer);
      this.castWatchTimer = null;
    }
  }

  /**
   * Fast poll for equip + casting + harpoon catch so the activity log stays responsive.
   * Heavy attach/hotbar work stays on the slower watchTick.
   */
  activityWatchTick() {
    if (!this.session.attached) return;
    try {
      const now = Date.now();
      // When fishing macro is OFF, poll far less — constant RPM stuttered Roblox/PC.
      const idle = !this.running;
      const gearKindEarly = resolveGearType(String(this.session.equippedRod || ''));
      // Harpoon catch log should feel instant even when Status is OFF.
      const tickGap = gearKindEarly === 'harpoon' ? 120 : idle ? 400 : 100;
      if (this._lastActivityTickAt && now - this._lastActivityTickAt < tickGap) {
        return;
      }
      this._lastActivityTickAt = now;

      const prevEquipped = String(this._lastLoggedEquippedRod || '');

      const equipGap = gearKindEarly === 'harpoon' ? 250 : idle ? 600 : 300;
      if (!this._lastEquipPollAt || now - this._lastEquipPollAt >= equipGap) {
        this._lastEquipPollAt = now;
        this.session.refreshEquippedRod();
      }

      const equipped = String(this.session.equippedRod || '');
      const gearKind = resolveGearType(equipped);
      if (equipped !== prevEquipped) {
        this.macro.suppressCastProbeAfterEquip();
        if (gearKind !== 'harpoon') {
          this.harpoonWatcher.resetSession();
        } else {
          this.harpoonWatcher.wake();
        }
      }

      let probe = { casting: false, power: '' };
      const castGap =
        gearKind === 'harpoon'
          ? 100
          : idle
            ? 350
            : this._lastLoggedCasting
              ? 75
              : 120;
      if (!this._lastCastPollAt || now - this._lastCastPollAt >= castGap) {
        this._lastCastPollAt = now;
        probe = this.macro.probePlayerCasting();
      } else {
        probe = {
          casting: !!this._lastLoggedCasting,
          power: ''
        };
      }

      const casting = !!probe.casting;
      if (gearKind === 'harpoon' && casting) {
        this.harpoonWatcher.wake();
      }

      const equippedChanged = equipped !== this._lastLoggedEquippedRod;
      const castingChanged =
        this._lastLoggedCasting !== null && casting !== this._lastLoggedCasting;

      let harpoonCatch = false;
      let harpoonPull = false;
      let harpoonPullStarted = false;
      const harpoonGap =
        this.harpoonWatcher.phase === 'pull' ? 80 : casting ? 100 : 200;
      if (
        gearKind === 'harpoon' &&
        (!this._lastHarpoonPollAt || now - this._lastHarpoonPollAt >= harpoonGap)
      ) {
        this._lastHarpoonPollAt = now;
        const h = this.harpoonWatcher.tick();
        harpoonCatch = !!h.caught;
        harpoonPull = !!h.active;
        harpoonPullStarted = !!h.started;
        if (harpoonCatch) this._lastCatchSource = 'harpoon';
      } else if (gearKind === 'harpoon') {
        harpoonPull = this.harpoonWatcher.phase === 'pull';
      }

      if (harpoonPullStarted) this._lastLoggedHarpoonPull = true;
      if (!harpoonPull) this._lastLoggedHarpoonPull = false;

      if (!equippedChanged && !castingChanged && !harpoonCatch && !harpoonPullStarted) {
        return;
      }

      this.emitStatus({
        playerCasting: casting,
        power: probe.power !== '' ? probe.power + '%' : '---',
        harpoonPullActive: harpoonPull,
        lastCatchSource: harpoonCatch ? 'harpoon' : undefined,
        harpoonPullStarted: harpoonPullStarted || undefined
      });
    } catch {
      // ignore probe failures while idle
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
    const equip = this.session.ensureRodEquipped();
    if (equip.ok && !equip.already && equip.method === 't') {
      log.info(`Equipped rod: ${equip.rod || 'rod'} (T)`);
    } else if (equip.ok && equip.already && equip.kind === 'harpoon') {
      log.info(`Harpoon already equipped (manual): ${equip.rod}`);
    } else if (!equip.ok) {
      log.warn(
        equip.error ||
          'Could not auto-equip rod — press T in Fisch, or equip a harpoon manually'
      );
    }
    this.macro.startCycle();

    this.running = true;
    this.startTickLoop();
    log.info(
      `Fishing started (cast ${this.macro.settings.cast_mode}/${this.macro.settings.cast_power_custom}%)`
    );
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
    log.info('Appraise started');
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
    log.info(`Stopped (${phase})`);
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
