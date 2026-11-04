'use strict';
// Exit 0 only if out/sales.csv holds the real CSV report.
const fs = require('fs');
let t;
try { t = fs.readFileSync('out/sales.csv', 'utf8'); } catch (e) { console.error('out/sales.csv missing'); process.exit(1); }
const want = 'region,units,revenue\nnorth,120,300\nsouth,80,320\neast,45,450\n';
if (t.replace(/\r\n/g, '\n') !== want) { console.error('unexpected content:\n' + t); process.exit(1); }
process.exit(0);
