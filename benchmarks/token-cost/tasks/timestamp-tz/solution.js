'use strict';
// The intended fix: format with the UTC getters instead of local-time getters.
const fs = require('fs');
const f = 'src/format.js';
let s = fs.readFileSync(f, 'utf8');
s = s.replace(/getFullYear/g, 'getUTCFullYear').replace(/getMonth/g, 'getUTCMonth')
  .replace(/getDate/g, 'getUTCDate').replace(/getHours/g, 'getUTCHours').replace(/getMinutes/g, 'getUTCMinutes');
fs.writeFileSync(f, s);
