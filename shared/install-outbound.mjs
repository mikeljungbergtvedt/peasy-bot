import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { installOutboundFetch } = require('./outbound.js');

const script = String(process.argv[1] || '');
let label = process.env.PEASY_PROCESS_LABEL || 'v2';
if (script.includes('peasy-bot')) label = 'v2-bot';
else if (script.includes('v2-watcher')) label = 'v2-watcher';

installOutboundFetch({ label });
