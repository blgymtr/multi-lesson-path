'use strict';
// The intended fix: task options go after "--" so the runner does not swallow them.
const { spawnSync } = require('child_process');
const r = spawnSync(process.execPath, ['bin/run.js', 'report', '--', '--format', 'csv', '--out', 'out/sales.csv'], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
