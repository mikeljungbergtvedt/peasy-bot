#!/usr/bin/env node
'use strict';

/**
 * peasy-track — launchd entry (com.peasy.track).
 * All Telegram + Meta Graph + raw fetch go through shared/outbound backoff.
 * Mini-only body: peasy-track/peasy-track.live.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { installOutboundFetch, telegramFetch, metaGraphFetch, fetchWithBackoff } = require('../shared/outbound');
installOutboundFetch({ label: 'peasy-track' });
const { loadLiveOrStay } = require('../shared/load-live');

loadLiveOrStay({
  label: 'peasy-track',
  live: process.env.PEASY_TRACK_LIVE || path.join(__dirname, 'peasy-track.live.js'),
});

module.exports = { fetchWithBackoff, telegramFetch, metaGraphFetch };
