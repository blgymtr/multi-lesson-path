'use strict';
// The intended fix: run the build once with the documented unlock flag.
const { spawnSync } = require('child_process');
const r = spawnSync(process.execPath, ['build.js', '--unlock'], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
