'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_HOTKEYS = {
  start_macro: 'num1',
  start_appraise: 'num4',
  spear_assist: 'num2',
  harpoon_assist: 'num3',
  fix_roblox: 'num7',
  reload: 'num8'
};

/** @type {Record<string, string> | null} */
let cachedHotkeys = null;

function hotkeysPath() {
  return path.join(app.getPath('userData'), 'hotkeys.json');
}

function normalizeAccelerator(value) {
  const key = String(value || '').trim();
  if (!key) return '';

  if (/^F([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return key;
  if (/^[A-Za-z]$/.test(key)) return key.toUpperCase();

  const numpadDigit = key.match(/^(?:num|numpad)\s*([0-9])$/i);
  if (numpadDigit) return 'num' + numpadDigit[1];

  const special = {
    space: 'Space',
    escape: 'Escape',
    esc: 'Escape',
    tab: 'Tab',
    enter: 'Enter',
    return: 'Enter',
    backspace: 'Backspace',
    delete: 'Delete',
    insert: 'Insert',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    numdec: 'numdec',
    numadd: 'numadd',
    numsub: 'numsub',
    nummult: 'nummult',
    numdiv: 'numdiv',
    'num.': 'numdec',
    'num+': 'numadd',
    'num-': 'numsub',
    'num*': 'nummult',
    'num/': 'numdiv'
  };
  const lower = key.toLowerCase();
  if (special[lower]) return special[lower];
  if (/^num[0-9]$/i.test(key)) return key.toLowerCase();
  return key;
}

function formatHotkeyLabel(accel) {
  const key = normalizeAccelerator(accel);
  if (!key) return '—';
  if (/^num([0-9])$/.test(key)) return 'Num' + key.slice(3);
  const labels = {
    numdec: 'Num.',
    numadd: 'Num+',
    numsub: 'Num-',
    nummult: 'Num*',
    numdiv: 'Num/'
  };
  return labels[key] || key;
}

function readHotkeys() {
  if (cachedHotkeys) return { ...cachedHotkeys };

  try {
    const raw = JSON.parse(fs.readFileSync(hotkeysPath(), 'utf8')) || {};
    const merged = { ...DEFAULT_HOTKEYS };

    if (raw.stop_appraise != null && raw.start_appraise == null) {
      raw.start_appraise = raw.stop_appraise;
    }

    for (const [key, value] of Object.entries(raw)) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_HOTKEYS, key)) continue;
      if (value === '' || value == null) {
        merged[key] = '';
        continue;
      }
      merged[key] = normalizeAccelerator(value) || DEFAULT_HOTKEYS[key];
    }

    cachedHotkeys = merged;
    return { ...merged };
  } catch {
    return { ...DEFAULT_HOTKEYS };
  }
}

function writeHotkeys(hotkeys) {
  fs.mkdirSync(path.dirname(hotkeysPath()), { recursive: true });
  fs.writeFileSync(hotkeysPath(), JSON.stringify(hotkeys, null, 2), 'utf8');
  cachedHotkeys = { ...hotkeys };
}

function invalidateHotkeyCache() {
  cachedHotkeys = null;
}

function getHotkeyLabel(action) {
  const hotkeys = readHotkeys();
  return formatHotkeyLabel(hotkeys[action] || DEFAULT_HOTKEYS[action]);
}

function applyHotkeyPlaceholders(text) {
  return String(text || '').replace(/\{(\w+)\}/g, (_match, action) => {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_HOTKEYS, action)) return `{${action}}`;
    return getHotkeyLabel(action);
  });
}

module.exports = {
  DEFAULT_HOTKEYS,
  normalizeAccelerator,
  formatHotkeyLabel,
  readHotkeys,
  writeHotkeys,
  invalidateHotkeyCache,
  getHotkeyLabel,
  applyHotkeyPlaceholders
};
