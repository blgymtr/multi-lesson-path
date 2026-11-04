'use strict';
const fs = require('fs');
let s = fs.readFileSync('src/mathutil.js', 'utf8');
s = s.replace('module.exports = { sum, mean };',
  'function clamp(value, min, max) {\n  return Math.min(Math.max(value, min), max);\n}\n\nmodule.exports = { sum, mean, clamp };');
fs.writeFileSync('src/mathutil.js', s);
