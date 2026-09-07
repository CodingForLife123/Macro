/**
 * Load and flatten Roblox offsets.json (XTernal-compatible layout).
 * Auto-refreshes from the remote dump when Roblox updates.
 * AGPL-3.0-only — see NOTICE / LICENSE.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const OFFSETS_URL = 'https://offsets.imtheo.lol/offsets.json';
const MIN_REFRESH_INTERVAL_MS = 60_000;

const RENAME_MAP = [
  ['FakeDataModel', 'Pointer', 'FakeDataModelPointer'],
  ['FakeDataModel', 'RealDataModel', 'FakeDataModelToDataModel'],
  ['VisualEngine', 'Pointer', 'VisualEnginePointer'],
  ['VisualEngine', 'FakeDataModel', 'VisualEngineToDataModel1'],
  ['FakeDataModel', 'RealDataModel', 'VisualEngineToDataModel2'],
  ['DataModel', 'PlaceId', 'PlaceId'],
  ['Player', 'LocalPlayer', 'LocalPlayer'],
  ['Instance', 'Name', 'Name'],
  ['Instance', 'NameContainer', 'NameContainer'],
  ['Instance', 'ClassDescriptor', 'ClassDescriptor'],
  ['Instance', 'ClassName', 'ClassDescriptorToClassName'],
  ['Instance', 'ChildrenStart', 'Children'],
  ['Instance', 'Parent', 'Parent'],
  ['Misc', 'StringLength', 'StringLength'],
  ['Misc', 'Value', 'Value'],
  ['GuiObject', 'Text', 'TextLabelText'],
  ['GuiObject', 'Visible', 'TextLabelVisible'],
  ['GuiObject', 'Visible', 'FrameVisible'],
  ['GuiObject', 'ScreenGui_Enabled', 'ScreenGuiEnabled'],
  ['GuiObject', 'Position', 'FramePositionX'],
  ['GuiObject', 'Size', 'FrameSizeX'],
  ['GuiObject', 'Rotation', 'FrameRotation'],
  ['GuiBase2D', 'AbsolutePosition', 'AbsolutePosition'],
  ['GuiBase2D', 'AbsoluteSize', 'AbsoluteSize']
];

/** @type {Promise<object> | null} */
let refreshInFlight = null;
let lastRefreshAttemptAt = 0;

function bundledOffsetsPath() {
  return path.join(__dirname, '..', 'settings', 'offsets.json');
}

function userOffsetsPath() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'offsets.json');
    }
  } catch {
    // electron unavailable (plain node scripts)
  }
  return null;
}

function defaultOffsetsPath() {
  return bundledOffsetsPath();
}

function resolveOffsetsFilePath() {
  const userPath = userOffsetsPath();
  if (userPath && fs.existsSync(userPath)) return userPath;
  return bundledOffsetsPath();
}

function readOffsetsFile(filePath) {
  const resolved = filePath || resolveOffsetsFilePath();
  if (!fs.existsSync(resolved)) {
    throw new Error(`offsets.json not found at: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function normalizeOffsetsDocument(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid offsets document');
  const version = String(raw.version || raw['Roblox Version'] || '').trim();
  const nested = raw.offsets || raw.Offsets;
  if (!nested || typeof nested !== 'object') {
    throw new Error("'offsets' section not found in offsets.json");
  }
  return {
    version,
    source: String(raw.source || raw.Source || OFFSETS_URL),
    offsets: nested
  };
}

function flattenOffsets(parsed) {
  const doc = normalizeOffsetsDocument(parsed);
  const nested = doc.offsets;
  const flat = Object.create(null);

  for (const [category, field, legacy] of RENAME_MAP) {
    const cat = nested[category];
    if (!cat || cat[field] == null) continue;
    const value = Number(cat[field]);
    if (!value) continue; // 0 means unresolved in dumpers
    flat[legacy] = value;
  }

  if (flat.StringLength == null) flat.StringLength = 0x10;

  if (flat.FakeDataModelPointer == null) {
    throw new Error('FakeDataModelPointer not found in offsets');
  }

  return { version: doc.version, offsets: flat, source: doc.source };
}

function loadOffsets(filePath) {
  const parsed = readOffsetsFile(filePath);
  return flattenOffsets(parsed);
}

function getLocalOffsetsVersion() {
  try {
    return loadOffsets().version || '';
  } catch {
    return '';
  }
}

function writeUserOffsets(doc) {
  const userPath = userOffsetsPath();
  const target = userPath || bundledOffsetsPath();
  const normalized = normalizeOffsetsDocument(doc);
  // Validate flatten before writing
  flattenOffsets(normalized);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  // Also refresh bundled copy when writable (dev installs)
  if (userPath) {
    try {
      const bundled = bundledOffsetsPath();
      if (fs.existsSync(path.dirname(bundled))) {
        fs.writeFileSync(bundled, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
      }
    } catch {
      // packaged asar / read-only — userData copy is enough
    }
  }
  return { path: target, version: normalized.version };
}

function fetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Macro/0.0.1 (offsets-autofix)'
        },
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchJson(res.headers.location, timeoutMs).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Offsets download failed (HTTP ${res.statusCode})`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve(JSON.parse(text));
          } catch (err) {
            reject(new Error('Offsets download returned invalid JSON'));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Offsets download timed out'));
    });
    req.on('error', reject);
  });
}

/**
 * Download latest offsets and write them if newer (or force).
 * @param {{ force?: boolean, url?: string }} [options]
 * @returns {Promise<{ ok: boolean, updated: boolean, version: string, previous: string, skipped?: string, error?: string }>}
 */
async function refreshOffsetsFromRemote(options = {}) {
  if (refreshInFlight) return refreshInFlight;

  const force = !!options.force;
  const now = Date.now();
  if (!force && now - lastRefreshAttemptAt < MIN_REFRESH_INTERVAL_MS) {
    return {
      ok: true,
      updated: false,
      version: getLocalOffsetsVersion(),
      previous: getLocalOffsetsVersion(),
      skipped: 'rate_limited'
    };
  }

  refreshInFlight = (async () => {
    lastRefreshAttemptAt = Date.now();
    const previous = getLocalOffsetsVersion();
    try {
      const raw = await fetchJson(options.url || OFFSETS_URL);
      const normalized = normalizeOffsetsDocument(raw);
      flattenOffsets(normalized); // validate

      if (!force && normalized.version && previous && normalized.version === previous) {
        return {
          ok: true,
          updated: false,
          version: previous,
          previous,
          skipped: 'same_version'
        };
      }

      const written = writeUserOffsets(normalized);
      return {
        ok: true,
        updated: !previous || written.version !== previous,
        version: written.version,
        previous
      };
    } catch (err) {
      return {
        ok: false,
        updated: false,
        version: previous,
        previous,
        error: err.message || String(err)
      };
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

module.exports = {
  OFFSETS_URL,
  loadOffsets,
  flattenOffsets,
  defaultOffsetsPath,
  bundledOffsetsPath,
  userOffsetsPath,
  resolveOffsetsFilePath,
  getLocalOffsetsVersion,
  refreshOffsetsFromRemote,
  writeUserOffsets,
  normalizeOffsetsDocument
};
