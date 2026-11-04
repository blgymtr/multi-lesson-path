'use strict';
const m = require(require('path').resolve('src/mathutil'));
const ok = typeof m.clamp === 'function' && m.clamp(5, 0, 3) === 3 && m.clamp(-1, 0, 3) === 0 &&
  m.clamp(2, 0, 3) === 2 && typeof m.sum === 'function' && typeof m.mean === 'function';
if (!ok) { console.error('clamp missing or wrong'); process.exit(1); }
process.exit(0);
