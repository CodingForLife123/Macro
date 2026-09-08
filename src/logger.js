/**
 * Simple stdout logger for Macro (shows in the npm start / CMD terminal).
 * AGPL-3.0-only — see NOTICE / LICENSE.
 */
'use strict';

function stamp() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function write(level, args) {
  const prefix = `[Macro ${stamp()}]`;
  if (level === 'error') console.error(prefix, ...args);
  else if (level === 'warn') console.warn(prefix, ...args);
  else console.log(prefix, ...args);
}

const log = {
  info(...args) {
    write('info', args);
  },
  warn(...args) {
    write('warn', args);
  },
  error(...args) {
    write('error', args);
  },
  debug(...args) {
    if (process.env.MACRO_DEBUG === '1' || process.env.MACRO_DEBUG === 'true') {
      write('info', args);
    }
  }
};

module.exports = { log };
