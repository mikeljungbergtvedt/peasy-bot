#!/usr/bin/env node
'use strict';

/**
 * Bot4 watcher — launchd entry (com.peasy.bot4).
 * All Telegram + Meta Graph + raw fetch go through shared/outbound backoff.
 * Mini-only body: bot4/watcher.live.js (not overwritten by this file).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { installOutboundFetch, telegramFetch, metaGraphFetch, fetchWithBackoff } = require('../shared/outbound');
installOutboundFetch({ label: 'bot4' });
const { loadLiveOrStay } = require('../shared/load-live');

loadLiveOrStay({
  label: 'bot4',
  live: process.env.BOT4_LIVE || path.join(__dirname, 'watcher.live.js'),
});

module.exports = { fetchWithBackoff, telegramFetch, metaGraphFetch };
