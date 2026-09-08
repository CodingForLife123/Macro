/**
 * Harpoon Gun catch detection (passive).
 * Counts a catch when a real PULL / hooked-fish banner session ends.
 * Does NOT auto-click or auto-equip — see GEAR.md.
 * AGPL-3.0-only — see NOTICE / LICENSE.
 */
'use strict';

const { resolveGearType } = require('./rods');

const SKIP_GUI_NAME_RE =
  /backpack|hotbar|chat|bubble|playerlist|topbar|menu|shop|inventory|health|leaderboard|settings|bestiary/i;

const BANNER_EXCLUDE_RE =
  /fish name|rod name|leave|back|dismiss|afk|day \d|respawn|press any|connect the|wish for|failed|loading|roslit|all\]|continue|message/i;

function normalizePullText(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function isPullPromptText(text) {
  const clean = normalizePullText(text);
  // Exact prompt only — never "Magnetic Pull" / HUD noise.
  return /^PULL(?:\s*[!?.]*)?(?:\s*\(\s*\d+\s*\))?$/.test(clean);
}

function isHookedFishBanner(text) {
  const t = String(text || '')
    .replace(/<[^>]+>/g, '')
    .trim();
  if (!/^\[[^\]]{2,40}\]$/.test(t)) return false;
  if (BANNER_EXCLUDE_RE.test(t)) return false;
  return /^\[\s*[A-Za-z][\w' .-]{1,36}\s*\]$/.test(t);
}

function isHarpoonButtonName(name) {
  const n = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!n) return false;
  // Strict — do NOT match every name that merely contains "pull".
  for (const needle of ['minigamebutton', 'pullbutton', 'harpoonbutton', 'pullprompt']) {
    if (n === needle) return true;
  }
  return n === 'pull';
}

class HarpoonCatchWatcher {
  constructor(session) {
    this.session = session;
    this.caughtCount = 0;
    this.inPull = false;
    this.pullSeenAt = 0;
    this.pullLostAt = 0;
    this.cachedNode = 0;
    this.lastFullScanAt = 0;
    this.lastFishNameScanAt = 0;
    this.pendingHits = 0;
    this.catchCoolUntil = 0;
    this._idleSkipUntil = 0;
    this._lastHadPullRoots = false;
    /** @type {'idle'|'pull'} */
    this.phase = 'idle';
  }

  resetSession() {
    this.inPull = false;
    this.pullSeenAt = 0;
    this.pullLostAt = 0;
    this.cachedNode = 0;
    this.pendingHits = 0;
    this._idleSkipUntil = 0;
    this.phase = 'idle';
  }

  resetAll() {
    this.resetSession();
    this.caughtCount = 0;
    this.catchCoolUntil = 0;
  }

  wake() {
    // Called when the player casts / equips — scan immediately for PULL.
    this._idleSkipUntil = 0;
    this.lastFullScanAt = 0;
    this.lastFishNameScanAt = 0;
  }

  /**
   * @returns {{ active: boolean, caught: boolean, started: boolean, phase: string }}
   */
  tick() {
    const equipped = String(this.session.equippedRod || '');
    if (resolveGearType(equipped) !== 'harpoon') {
      this.resetSession();
      return { active: false, caught: false, started: false, phase: 'idle' };
    }

    const now = Date.now();
    if (now < this.catchCoolUntil) {
      this.resetSession();
      return { active: false, caught: false, started: false, phase: 'idle' };
    }

    const rawPull = this.isPullActive();
    if (rawPull) {
      this.pendingHits = Math.min(5, this.pendingHits + 1);
    } else {
      this.pendingHits = 0;
    }
    // First real PULL text hit is enough — multi-hit debounce made the log feel late.
    const pull = rawPull && this.pendingHits >= 1;

    let started = false;

    if (pull) {
      if (!this.inPull) {
        this.inPull = true;
        this.pullSeenAt = now;
        started = true;
      }
      this.pullLostAt = 0;
      this.phase = 'pull';
      return { active: true, caught: false, started, phase: 'pull' };
    }

    if (this.inPull) {
      if (!this.pullLostAt) this.pullLostAt = now;
      const heldMs = now - this.pullSeenAt;
      const goneMs = now - this.pullLostAt;
      // Real pulls last longer than HUD flicker; don't credit tiny blips.
      if (heldMs >= 700 && goneMs >= 450) {
        this.inPull = false;
        this.pullSeenAt = 0;
        this.pullLostAt = 0;
        this.cachedNode = 0;
        this.pendingHits = 0;
        this.phase = 'idle';
        this.caughtCount += 1;
        this.catchCoolUntil = now + 2000;
        return { active: false, caught: true, started: false, phase: 'idle' };
      }
      // Drop aborted / flicker sessions without counting.
      if (heldMs < 700 && goneMs >= 300) {
        this.resetSession();
        return { active: false, caught: false, started: false, phase: 'idle' };
      }
      this.phase = 'pull';
      return { active: true, caught: false, started: false, phase: 'pull' };
    }

    this.phase = 'idle';
    return { active: false, caught: false, started: false, phase: 'idle' };
  }

  isPullActive() {
    const mem = this.session.mem;
    if (!mem || !mem.ready) return false;

    const now = Date.now();
    // Short skip only — long skips made real PULL feel delayed.
    if (!this.inPull && this._idleSkipUntil && now < this._idleSkipUntil) {
      return false;
    }

    if (this.cachedNode) {
      if (this.nodeHasPullSignal(this.cachedNode)) return true;
      this.cachedNode = 0;
    }

    const gap = this.inPull ? 80 : 150;
    if (this.lastFullScanAt && now - this.lastFullScanAt < gap) {
      return false;
    }
    this.lastFullScanAt = now;

    const node = this.findPullSignalNode();
    if (node) {
      this.cachedNode = node;
      this._idleSkipUntil = 0;
      return true;
    }

    // Hooked banner can appear even when PULL lives outside a "harpoon" ScreenGui.
    const fishGap = this.inPull ? 200 : 450;
    if (now - (this.lastFishNameScanAt || 0) >= fishGap) {
      this.lastFishNameScanAt = now;
      if (this.findHookedFishNameLabel()) {
        this._idleSkipUntil = 0;
        return true;
      }
    }

    if (!this.inPull) this._idleSkipUntil = now + 280;
    return false;
  }

  findPullSignalNode() {
    const playerGui = this.session.findPlayerGui();
    if (!playerGui) {
      this._lastHadPullRoots = false;
      return 0;
    }

    const mem = this.session.mem;
    const enOff = mem.offsets.ScreenGuiEnabled;
    const preferred = [];
    const fallback = [];

    try {
      for (const child of mem.readChildren(playerGui)) {
        let name = '';
        let className = '';
        try {
          name = String(mem.readInstanceName(child) || '').toLowerCase();
          className = mem.readClassName(child);
        } catch {
          continue;
        }
        if (SKIP_GUI_NAME_RE.test(name)) continue;
        if (className === 'ScreenGui' && enOff != null) {
          try {
            if (!mem.readByte(Number(child) + enOff)) continue;
          } catch {
            continue;
          }
        }
        if (name.includes('harpoon') || name.includes('pull') || name === 'over') {
          preferred.push(child);
        } else if (className === 'ScreenGui') {
          fallback.push(child);
        }
      }
    } catch {
      // ignore
    }

    this._lastHadPullRoots = preferred.length > 0;

    for (const root of preferred) {
      const found = this.bfsFindPullSignal(root, 220);
      if (found) return found;
    }

    // PULL UI is often a short-lived ScreenGui without "harpoon" in the name.
    let scanned = 0;
    for (const root of fallback) {
      if (scanned >= 10) break;
      scanned += 1;
      const found = this.bfsFindPullTextOnly(root, 140);
      if (found) return found;
    }
    return 0;
  }

  bfsFindPullTextOnly(root, maxNodes) {
    if (!root) return 0;
    const mem = this.session.mem;
    const queue = [root];
    let index = 0;
    while (index < queue.length && index < maxNodes) {
      const current = queue[index++];
      try {
        const className = mem.readClassName(current);
        if (
          className === 'TextLabel' ||
          className === 'TextButton' ||
          className === 'ImageButton'
        ) {
          try {
            if (mem.readGuiObjectVisible(current) && isPullPromptText(mem.readGuiText(current))) {
              return current;
            }
          } catch {
            // ignore
          }
        }
        const name = String(mem.readInstanceName(current) || '').toLowerCase();
        if (index > 1 && SKIP_GUI_NAME_RE.test(name)) continue;
        for (const child of mem.readChildren(current)) queue.push(child);
      } catch {
        // ignore
      }
    }
    return 0;
  }

  bfsFindPullSignal(root, maxNodes) {
    if (!root) return 0;
    const mem = this.session.mem;
    const queue = [root];
    let index = 0;
    while (index < queue.length && index < maxNodes) {
      const current = queue[index++];
      if (this.nodeHasPullSignal(current)) return current;
      try {
        const name = String(mem.readInstanceName(current) || '').toLowerCase();
        if (index > 1 && SKIP_GUI_NAME_RE.test(name)) continue;
        for (const child of mem.readChildren(current)) queue.push(child);
      } catch {
        // ignore
      }
    }
    return 0;
  }

  nodeHasPullSignal(instanceAddr) {
    if (!instanceAddr) return false;
    const mem = this.session.mem;
    try {
      // Must be on-screen / visible — dormant templates caused constant hits.
      try {
        if (!mem.readGuiObjectVisible(instanceAddr)) return false;
      } catch {
        // some instances lack Visible; continue carefully
      }

      const className = mem.readClassName(instanceAddr);
      const name = mem.readInstanceName(instanceAddr);
      const text = mem.readGuiText(instanceAddr);

      // Prefer real PULL text. Button-name alone is not enough.
      if (isPullPromptText(text) || isPullPromptText(name)) return true;

      if (isHarpoonButtonName(name)) {
        for (const child of mem.readChildren(instanceAddr)) {
          try {
            if (!mem.readGuiObjectVisible(child)) continue;
            if (isPullPromptText(mem.readGuiText(child))) return true;
          } catch {
            // ignore
          }
        }
      }

      if (
        className === 'TextLabel' ||
        className === 'TextButton' ||
        className === 'ImageButton'
      ) {
        for (const child of mem.readChildren(instanceAddr)) {
          try {
            if (!mem.readGuiObjectVisible(child)) continue;
            if (isPullPromptText(mem.readGuiText(child))) return true;
          } catch {
            // ignore
          }
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  /** Visible hooked banner like "[Flounder]" during a harpoon catch. */
  findHookedFishNameLabel() {
    const playerGui = this.session.findPlayerGui();
    if (!playerGui) return false;
    const mem = this.session.mem;
    const queue = [playerGui];
    let index = 0;
    while (index < queue.length && index < 700) {
      const current = queue[index++];
      try {
        const name = String(mem.readInstanceName(current) || '');
        const lower = name.toLowerCase();
        if (index > 1 && SKIP_GUI_NAME_RE.test(lower)) continue;

        const className = mem.readClassName(current);
        if (className === 'TextLabel' || lower.includes('fishname')) {
          const text = String(mem.readGuiText(current) || '').trim();
          if (isHookedFishBanner(text) && mem.readGuiObjectVisible(current)) {
            const size = mem.readGuiVector2(current, 'AbsoluteSize');
            const pos = mem.readGuiVector2(current, 'AbsolutePosition');
            // Real hooked banner is large; ignore tiny templates.
            if (
              size &&
              pos &&
              size.X >= 90 &&
              size.Y >= 28 &&
              pos.X > 40 &&
              pos.Y > 40 &&
              pos.X < 1600 &&
              pos.Y < 900
            ) {
              return true;
            }
          }
        }

        for (const child of mem.readChildren(current)) queue.push(child);
      } catch {
        // ignore
      }
    }
    return false;
  }
}

module.exports = {
  HarpoonCatchWatcher,
  isPullPromptText,
  isHarpoonButtonName,
  isHookedFishBanner
};
