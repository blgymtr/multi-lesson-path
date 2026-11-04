'use strict';
const fs = require('fs');
const path = require('path');

const LOCK = path.join(__dirname, '..', '.stage', 'lock');

// Returns true when the stage may be entered.
function enter(argv) {
  if (fs.existsSync(LOCK)) {
    if (!argv.includes('--unlock')) return false;
    fs.unlinkSync(LOCK);
  }
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  fs.writeFileSync(LOCK, 'pid=' + process.pid + '\n');
  return true;
}

function leave() {
  try { fs.unlinkSync(LOCK); } catch (e) { /* already gone */ }
}

module.exports = { enter, leave };
