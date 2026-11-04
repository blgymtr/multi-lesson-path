#!/usr/bin/env node
'use strict';
// Task runner: node bin/run.js <task> [runner options] [-- task options]
const path = require('path');

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const own = sep < 0 ? argv : argv.slice(0, sep);
const passthrough = sep < 0 ? [] : argv.slice(sep + 1);

const opts = { task: null, format: 'text', quiet: false };
for (let i = 0; i < own.length; i++) {
  const a = own[i];
  if (a === '--quiet') opts.quiet = true;
  else if (a === '--format') {
    const v = own[++i];
    if (v === 'text' || v === 'json') opts.format = v;
  } else if (a.startsWith('--')) {
    continue; // unknown runner flags are ignored
  } else if (!opts.task) opts.task = a;
}

if (!opts.task) {
  console.error('usage: node bin/run.js <task> [-- task options]');
  process.exit(2);
}

const task = require(path.join(__dirname, '..', 'tasks', opts.task));
const log = (msg) => { if (!opts.quiet) console.log(opts.format === 'json' ? JSON.stringify({ msg }) : msg); };
log('running ' + opts.task);
task.run(passthrough, { log, root: path.join(__dirname, '..') });
