#!/usr/bin/env node
'use strict';
// Runs every test/*.test.js with the node:test runner. Listing the files explicitly keeps
// helper/fixture scripts out of the run and works the same on Node 18+ and on Windows
// (where `node --test test/` is not portable across Node versions).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'test');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join('test', f));
const extra = process.argv.slice(2);
const r = spawnSync(process.execPath, ['--test', ...extra, ...files], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
});
process.exitCode = r.status === null ? 1 : r.status;
