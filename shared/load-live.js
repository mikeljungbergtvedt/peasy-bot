'use strict';

const fs = require('fs');

/**
 * Repo is source of truth for the outbound hook + launchd entry.
 * Mini-only watcher bodies (not in git) live next to the entry as *.live.js.
 */
function loadLiveOrStay({ label, live }) {
  if (live && fs.existsSync(live)) {
    console.log(`[${label}] outbound hook on; loading ${live}`);
    require(live);
    return 'live';
  }
  console.log(`[${label}] outbound hook installed. Mini live body not in this repo (${live || 'none'}). Staying up for launchd.`);
  setInterval(() => {}, 60 * 60 * 1000);
  return 'idle';
}

module.exports = { loadLiveOrStay };
