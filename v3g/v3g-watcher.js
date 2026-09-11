#!/usr/bin/env node
'use strict';

/**
 * V3G watcher — launchd entry (com.peasy.v3g).
 * All Telegram + Meta Graph + raw fetch go through shared/outbound backoff.
 * Mini-only body: v3g/v3g-watcher.live.js (not overwritten by this file).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { installOutboundFetch, telegramFetch, metaGraphFetch, fetchWithBackoff } = require('../shared/outbound');
installOutboundFetch({ label: 'v3g' });
const { loadLiveOrStay } = require('../shared/load-live');

loadLiveOrStay({
  label: 'v3g',
  live: process.env.V3G_LIVE || path.join(__dirname, 'v3g-watcher.live.js'),
});

module.exports = { fetchWithBackoff, telegramFetch, metaGraphFetch };
