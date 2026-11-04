#!/usr/bin/env node
'use strict';
// Installs .git/hooks/pre-commit so every commit runs the privacy check.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const gitDir = path.join(root, '.git');

let stat;
try { stat = fs.statSync(gitDir); } catch (e) { stat = null; }
if (!stat || !stat.isDirectory()) {
  console.error('setup-dev: ' + gitDir + ' is not a git directory; run `git init` first.');
  process.exit(1);
}
const hooksDir = path.join(gitDir, 'hooks');
fs.mkdirSync(hooksDir, { recursive: true });
const file = path.join(hooksDir, 'pre-commit');
const script = [
  '#!/bin/sh',
  '# installed by `npm run setup-dev` (multi-lesson-path)',
  'exec node "$(git rev-parse --show-toplevel)/scripts/privacy-check.js"',
  '',
].join('\n');
fs.writeFileSync(file, script, { mode: 0o755 });
try { fs.chmodSync(file, 0o755); } catch (e) { /* not meaningful on Windows */ }
console.log('setup-dev: wrote ' + file);
