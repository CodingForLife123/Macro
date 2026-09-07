/**
 * Macro runtime requirements.
 * These must be installed and verifiable before the macro UI unlocks.
 */
module.exports = {
  platform: 'win32',
  packages: [
    {
      id: 'koffi',
      name: 'koffi',
      label: 'Native Windows bridge (koffi)',
      description: 'Needed to read Roblox process memory safely from Electron.',
      version: '^2.11.0'
    }
  ]
};
