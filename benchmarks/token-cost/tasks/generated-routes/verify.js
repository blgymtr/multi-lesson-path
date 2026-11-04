'use strict';
// Exit 0 only if /health works AFTER the routes are regenerated, as they are on every start.
const { spawnSync } = require('child_process');
const g = spawnSync(process.execPath, ['scripts/gen-routes.js'], { encoding: 'utf8' });
if (g.status !== 0) { console.error('generator failed: ' + g.stderr); process.exit(1); }
const probe = "const a=require('./src/app');" +
  "process.stdout.write(JSON.stringify([a.handle('GET','/health'),a.handle('GET','/'),a.handle('GET','/about')]))";
const r = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
let v;
try { v = JSON.parse(r.stdout); } catch (e) { console.error('app failed: ' + r.stderr); process.exit(1); }
if (!(v[0].status === 200 && v[0].body === 'ok')) { console.error('/health after regeneration: ' + JSON.stringify(v[0])); process.exit(1); }
if (v[1].body !== 'welcome' || v[2].body !== 'about us') { console.error('existing routes changed'); process.exit(1); }
process.exit(0);
