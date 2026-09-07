const { showCustomNotification } = require('./notificationHost');
const { toFriendlyError, toFriendlyStatus } = require('./friendlyErrors');
const { applyHotkeyPlaceholders } = require('./hotkeys');

const HOTKEY_LABELS = {
  start_macro: 'Start / toggle fishing',
  start_appraise: 'Start / toggle appraise',
  fix_roblox: 'Fix Roblox',
  reload: 'Reload',
  spear_assist: 'Spear assist',
  harpoon_assist: 'Harpoon assist'
};

/** @type {{ running: boolean, appraiseState: string, appraiseStatus: string, caught: number, lost: number, attached: boolean, error: string, phase: string, mode: string }} */
let lastStatus = {
  running: false,
  appraiseState: '',
  appraiseStatus: '',
  caught: 0,
  lost: 0,
  attached: false,
  error: '',
  phase: 'OFF',
  mode: 'off'
};

/** @type {() => boolean} */
let areNotificationsEnabled = () => true;

/**
 * @param {() => boolean} fn
 */
function setNotificationsEnabledGetter(fn) {
  areNotificationsEnabled = typeof fn === 'function' ? fn : () => true;
}

/**
 * Appraise keeps `appraiseState: 'IDLE'` even while fishing — only treat active appraise as running.
 * @param {Record<string, unknown>} status
 */
function isAppraiseRunning(status) {
  return status.rawPhase === 'APPRAISE' && !!status.cycleEnabled;
}

/**
 * @param {string} title
 * @param {string} body
 * @param {'success' | 'error' | 'warning' | 'info'} [type]
 */
function showDesktopNotification(title, body, type = 'info') {
  if (!areNotificationsEnabled()) return;
  showCustomNotification(title, toFriendlyStatus(body), { type });
}

function resetStatusNotifications() {
  lastStatus = {
    running: false,
    appraiseState: '',
    appraiseStatus: '',
    caught: 0,
    lost: 0,
    attached: false,
    error: '',
    phase: 'OFF',
    mode: 'off'
  };
}

function notifyHotkeyChanged(action, label) {
  const name = HOTKEY_LABELS[action] || action;
  showDesktopNotification('Hotkey updated', `${name}: ${label || 'Unbound'}`, 'info');
}

function handleStatusNotifications(status) {
  if (!status || typeof status !== 'object') return;

  const running = !!status.running;
  const appraiseState = String(status.appraiseState || '');
  const appraiseStatus = toFriendlyStatus(status.appraiseStatus || '');
  const caught = Number(status.caught) || 0;
  const lost = Number(status.lost) || 0;
  const attached = !!status.attached;
  const error = toFriendlyError(status.error || '');
  const phase = String(status.phase || status.rawPhase || 'OFF');
  const appraiseActive = isAppraiseRunning(status);
  const appraiseOutcomeState =
    appraiseActive ||
    phase === 'FAILED' ||
    phase === 'DONE' ||
    lastStatus.mode === 'appraise' ||
    (appraiseState && appraiseState !== 'IDLE');
  const mode = appraiseActive ? 'appraise' : running ? 'fishing' : 'off';

  let userMessageShown = false;

  const showUserMessage = (title, body, type = 'info') => {
    const text = applyHotkeyPlaceholders(String(body || '').trim());
    if (!text) return;
    showDesktopNotification(title, text, type);
    userMessageShown = true;
  };

  if (status.offsetsHeal && typeof status.offsetsHeal === 'object') {
    const heal = status.offsetsHeal;
    if (heal.ok === false && heal.error) {
      showUserMessage(
        'Auto-fix failed',
        heal.error || 'Could not download new offsets. Check your internet and try Fix Roblox.',
        'warning'
      );
    } else if (heal.updated && heal.version) {
      showUserMessage(
        'Offsets updated',
        `Auto-fix loaded Roblox build ${heal.version}.`,
        'success'
      );
    }
  }

  if (running && !lastStatus.running) {
    showUserMessage(
      'Macro started',
      appraiseActive ? 'Appraise is running.' : 'Fishing is on.',
      'success'
    );
  } else if (!running && lastStatus.running) {
    const finishedAppraise =
      appraiseState === 'DONE' || (lastStatus.mode === 'appraise' && /found|you got/i.test(appraiseStatus));
    if (!finishedAppraise) {
      const stopMessage =
        lastStatus.mode === 'appraise'
          ? appraiseStatus || 'Appraise stopped.'
          : appraiseStatus || 'Fishing stopped.';
      showUserMessage('Macro stopped', stopMessage, 'info');
    }
  }

  if (
    appraiseOutcomeState &&
    appraiseState === 'FAILED' &&
    (
      lastStatus.appraiseState !== 'FAILED' ||
      appraiseStatus !== lastStatus.appraiseStatus ||
      error !== lastStatus.error
    )
  ) {
    showUserMessage(
      'Appraise failed',
      appraiseStatus || error || 'Appraise did not work. Try again.',
      'error'
    );
  } else if (appraiseOutcomeState && appraiseState === 'DONE' && lastStatus.appraiseState !== 'DONE') {
    showUserMessage('Appraise complete', appraiseStatus || 'You got the mutation you wanted!', 'success');
  } else if (
    appraiseActive &&
    appraiseStatus &&
    appraiseStatus !== lastStatus.appraiseStatus &&
    /found|you got/i.test(appraiseStatus) &&
    appraiseState !== 'DONE'
  ) {
    showUserMessage('Appraise', appraiseStatus, 'success');
  }

  if (lost > lastStatus.lost) {
    showUserMessage('Fish lost', `Total lost: ${lost}`, 'warning');
  }

  if (attached && !lastStatus.attached) {
    showUserMessage(
      'Roblox connected',
      status.rod ? `Rod: ${status.rod}` : 'Attached to Roblox.',
      'success'
    );
  } else if (!attached && lastStatus.attached) {
    showUserMessage(
      'Roblox disconnected',
      error || applyHotkeyPlaceholders("Can't connect to Roblox. Press {fix_roblox} to fix."),
      'error'
    );
  } else if (error && error !== lastStatus.error && !userMessageShown && appraiseState !== 'FAILED') {
    // Quiet waiting states (menu / joining Fisch / Roblox loading) — status only, no toast.
    if (
      /not in fisch|still loading|open roblox first|open fisch/i.test(error) ||
      status.waitingForRoblox
    ) {
      // skip toast
    } else {
      showUserMessage(running ? 'Something went wrong' : 'Heads up', error, running ? 'error' : 'warning');
    }
  }

  lastStatus = {
    running,
    appraiseState,
    appraiseStatus,
    caught,
    lost,
    attached,
    error,
    phase,
    mode
  };
}

module.exports = {
  showDesktopNotification,
  handleStatusNotifications,
  notifyHotkeyChanged,
  resetStatusNotifications,
  setNotificationsEnabledGetter,
  HOTKEY_LABELS,
  isAppraiseRunning
};
