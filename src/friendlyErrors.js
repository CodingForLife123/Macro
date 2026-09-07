'use strict';

const { applyHotkeyPlaceholders } = require('./hotkeys');

/**
 * Turn technical macro errors into short, plain messages.
 * Use `{start_macro}`, `{start_appraise}`, `{fix_roblox}`, etc. for dynamic hotkeys.
 * @param {string} message
 * @returns {string}
 */
function toFriendlyError(message) {
  const msg = String(message || '').trim();
  if (!msg) return '';

  if (/subvalues|fishinfo|workspace/i.test(msg)) {
    return 'Hold your fish in your hand, then try appraise again.';
  }
  if (/hold.*fish|fish selected|have a fish|equipped tool|re-equip/i.test(msg)) {
    return 'Hold a fish in your hand first!';
  }
  if (/click point/i.test(msg)) {
    return 'Pick where to click in the Appraise tab first.';
  }
  if (/choose a desired mutation|choose.*mutation/i.test(msg)) {
    return 'Pick which mutation you want in the Appraise tab.';
  }
  if (/roblox is not running/i.test(msg)) {
    return 'Open Roblox first!';
  }
  if (/not in fisch|join.*fisch|open fisch/i.test(msg)) {
    return "You're not in Fisch yet. Open Fisch, then start the macro.";
  }
  if (/still loading|roblox is still loading/i.test(msg)) {
    return 'Roblox is still loading. Open Fisch and wait a moment.';
  }
  if (/offsets (do not match|look wrong|appear stale)|update settings\/offsets/i.test(msg)) {
    return applyHotkeyPlaceholders(
      'Offsets look wrong for this Roblox build. Auto-fix will retry, or press {fix_roblox}.'
    );
  }
  if (/not attached|attach failed|lost connection|could not re-attach/i.test(msg)) {
    return applyHotkeyPlaceholders("Can't connect to Roblox. Press {fix_roblox} to fix.");
  }
  if (/appraise is running.*hotkey|appraise is on/i.test(msg)) {
    return applyHotkeyPlaceholders('Appraise is on. Press {start_appraise} to stop it first.');
  }
  if (/fishing macro is running|fishing is on/i.test(msg)) {
    return applyHotkeyPlaceholders('Fishing is on. Press {start_macro} to stop it first.');
  }
  if (/enable auto appraise/i.test(msg)) {
    return 'Turn on auto appraise in the Appraise tab first.';
  }
  if (/roblox not ready/i.test(msg)) {
    return 'Roblox is not ready yet. Open the game and try again.';
  }
  if (/appraise failed to start/i.test(msg)) {
    return 'Appraise could not start. Check your settings and try again.';
  }

  return applyHotkeyPlaceholders(msg);
}

/**
 * @param {string} message
 * @returns {string}
 */
function toFriendlyStatus(message) {
  const msg = String(message || '').trim();
  if (!msg) return 'Ready.';

  const map = [
    [/^Resolving fish info\.?\.?\.?$/i, 'Checking your fish...'],
    [/^Waiting for fish info\/Subvalues/i, 'Waiting for fish info...'],
    [/^Clicking 1\/2\.?$/i, 'Click 1 of 2...'],
    [/^Clicking 2\/2\.?$/i, 'Click 2 of 2...'],
    [/^Still looking for (.+)\.?$/i, 'Still trying to get $1...'],
    [/^Retrying\.?$/i, 'Trying again...'],
    [/^Stopped by hotkey\.?$/i, 'Stopped.'],
    [/^Hold a fish before appraising\.?$/i, 'Hold a fish in your hand first!'],
    [/^Set a click point before appraising\.?$/i, 'Pick a click spot in the Appraise tab first.'],
    [/^Choose a desired mutation\.?$/i, 'Pick which mutation you want.'],
    [/^Found (.+)\.?$/i, 'You got $1!'],
    [/^(.+) mutation was already present\.?$/i, 'Your fish already has $1!'],
    [/^Stopped\.?$/i, 'Stopped.']
  ];

  for (const [pattern, replacement] of map) {
    if (pattern.test(msg)) return msg.replace(pattern, replacement);
  }

  return toFriendlyError(msg);
}

module.exports = {
  toFriendlyError,
  toFriendlyStatus
};
