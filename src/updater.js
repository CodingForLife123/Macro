/**
 * Check GitHub Releases for a newer Macro build (ZIP distribution).
 * AGPL-3.0-only — see NOTICE / LICENSE.
 */
'use strict';

const https = require('https');
const { app } = require('electron');

const GITHUB_OWNER = 'CodingForLife123';
const GITHUB_REPO = 'Macro';
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

/**
 * @param {string} value
 * @returns {number[]}
 */
function parseVersion(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[+-]/)[0];
  const parts = cleaned.split('.').map((p) => parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} 1 if a>b, -1 if a<b, 0 if equal
 */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}

function fetchJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Macro-Updater',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchJson(res.headers.location, timeoutMs).then(resolve, reject);
          return;
        }
        if (res.statusCode === 404) {
          res.resume();
          reject(
            new Error(
              'No public GitHub release found. Publish a Release on CodingForLife123/Macro (repo must be public for update checks).'
            )
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GitHub returned HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error('Invalid GitHub response'));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Update check timed out'));
    });
    req.on('error', reject);
  });
}

/**
 * Prefer the fast ZIP asset from the release.
 * @param {Array<{ name?: string, browser_download_url?: string }>} assets
 */
function pickDownloadAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const zipFast = list.find((a) => /\.zip$/i.test(a.name || '') && /fast/i.test(a.name || ''));
  if (zipFast?.browser_download_url) return zipFast;
  const zipAny = list.find((a) => /\.zip$/i.test(a.name || ''));
  if (zipAny?.browser_download_url) return zipAny;
  const exe = list.find((a) => /\.exe$/i.test(a.name || ''));
  if (exe?.browser_download_url) return exe;
  return null;
}

/**
 * @returns {Promise<{
 *   ok: boolean,
 *   updateAvailable: boolean,
 *   currentVersion: string,
 *   latestVersion: string,
 *   releaseName: string,
 *   releaseNotes: string,
 *   downloadUrl: string,
 *   releaseUrl: string,
 *   assetName: string,
 *   error?: string
 * }>}
 */
async function checkForUpdates() {
  const currentVersion = app.getVersion();
  try {
    const release = await fetchJson(RELEASES_API);
    const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
    if (!latestVersion) {
      return {
        ok: false,
        updateAvailable: false,
        currentVersion,
        latestVersion: '',
        releaseName: '',
        releaseNotes: '',
        downloadUrl: '',
        releaseUrl: RELEASES_PAGE,
        assetName: '',
        error: 'Latest release has no version tag.'
      };
    }

    const asset = pickDownloadAsset(release.assets || []);
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;

    return {
      ok: true,
      updateAvailable,
      currentVersion,
      latestVersion,
      releaseName: String(release.name || `Macro v${latestVersion}`),
      releaseNotes: String(release.body || '').trim(),
      downloadUrl: asset?.browser_download_url || release.html_url || RELEASES_PAGE,
      releaseUrl: release.html_url || RELEASES_PAGE,
      assetName: asset?.name || ''
    };
  } catch (err) {
    return {
      ok: false,
      updateAvailable: false,
      currentVersion,
      latestVersion: '',
      releaseName: '',
      releaseNotes: '',
      downloadUrl: '',
      releaseUrl: RELEASES_PAGE,
      assetName: '',
      error: err.message || String(err)
    };
  }
}

module.exports = {
  GITHUB_OWNER,
  GITHUB_REPO,
  RELEASES_PAGE,
  checkForUpdates,
  compareVersions,
  parseVersion
};
