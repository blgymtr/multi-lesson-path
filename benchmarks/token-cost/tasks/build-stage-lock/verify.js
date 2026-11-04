'use strict';
// Exit 0 only if dist/bundle.js was really rebuilt from the current sources.
const fs = require('fs');
let b;
try { b = fs.readFileSync('dist/bundle.js', 'utf8'); } catch (e) { console.error('dist/bundle.js missing'); process.exit(1); }
if (!/^\/\* bundle built from 2 files \*\//.test(b)) { console.error('bundle header is not from a fresh build'); process.exit(1); }
if (!/const VERSION = 2;/.test(b)) { console.error('bundle does not contain VERSION = 2'); process.exit(1); }
if (!/function greet\(/.test(b)) { console.error('greet missing'); process.exit(1); }
if (fs.readFileSync('src/version.js', 'utf8').indexOf('VERSION = 2') < 0) { console.error('src/version.js was altered'); process.exit(1); }
process.exit(0);
