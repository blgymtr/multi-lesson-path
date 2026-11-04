'use strict';
// Exit 0 only if formatTimestamp gives the same answer in every time zone and
// the test file still asserts the original expected values.
const fs = require('fs');
const { spawnSync } = require('child_process');

const t = fs.readFileSync('test.js', 'utf8');
if (t.indexOf("'2024-06-01 14:30'") < 0 || t.indexOf("'2023-12-31 23:59'") < 0) {
  console.error('expected values in test.js were changed'); process.exit(1);
}
const probe = "const f=require('./src/format').formatTimestamp;" +
  "process.stdout.write(f(1717252200000)+'|'+f(1704067140000))";
for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Auckland']) {
  const r = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8', env: Object.assign({}, process.env, { TZ: tz }) });
  if (r.stdout !== '2024-06-01 14:30|2023-12-31 23:59') { console.error('TZ=' + tz + ' gave ' + r.stdout + r.stderr); process.exit(1); }
  const q = spawnSync(process.execPath, ['test.js'], { encoding: 'utf8', env: Object.assign({}, process.env, { TZ: tz }) });
  if (q.status !== 0) { console.error('test.js fails under TZ=' + tz); process.exit(1); }
}
process.exit(0);
