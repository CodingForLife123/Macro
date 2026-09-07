'use strict';

/**
 * Zip dist/win-unpacked into a shareable fast-start package.
 * Users extract once, then Macro.exe opens quickly (no re-unpack each launch).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const unpacked = path.join(root, 'dist', 'win-unpacked');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outZip = path.join(root, 'dist', `${pkg.productName || 'Macro'}-${pkg.version}-fast.zip`);

if (!fs.existsSync(unpacked)) {
  console.error('Missing dist/win-unpacked. Run: npm run dist:dir');
  process.exit(1);
}

if (fs.existsSync(outZip)) fs.unlinkSync(outZip);

const ps = `
Compress-Archive -Path '${unpacked.replace(/'/g, "''")}\\*' -DestinationPath '${outZip.replace(/'/g, "''")}' -Force
`;

const result = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-Command', ps],
  { stdio: 'inherit' }
);

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log('Created', outZip);
console.log('Share this ZIP for fast startup: extract, then run Macro.exe');
