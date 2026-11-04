'use strict';
// The intended fix: add the route to the spec, then regenerate.
const fs = require('fs');
const { spawnSync } = require('child_process');
const spec = JSON.parse(fs.readFileSync('routes.spec.json', 'utf8'));
spec.push({ method: 'GET', path: '/health', status: 200, body: 'ok' });
fs.writeFileSync('routes.spec.json', JSON.stringify(spec, null, 2) + '\n');
process.exit(spawnSync(process.execPath, ['scripts/gen-routes.js'], { stdio: 'inherit' }).status || 0);
