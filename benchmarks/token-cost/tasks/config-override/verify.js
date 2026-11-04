'use strict';
// Exit 0 only if the service really runs on port 8080 and the host is unchanged.
const { spawnSync } = require('child_process');
const r = spawnSync(process.execPath, ['src/index.js', '--print-config'], { encoding: 'utf8' });
if (r.status !== 0) { console.error('app failed to run: ' + r.stderr); process.exit(1); }
let cfg;
try { cfg = JSON.parse(r.stdout); } catch (e) { console.error('--print-config is not JSON'); process.exit(1); }
if (cfg.port !== 8080) { console.error('effective port is ' + cfg.port); process.exit(1); }
if (cfg.host !== '127.0.0.1') { console.error('host changed to ' + cfg.host); process.exit(1); }
process.exit(0);
