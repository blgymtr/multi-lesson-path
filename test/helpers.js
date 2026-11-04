'use strict';
// Shared test helpers. Never touches the real home: every test uses a temp MLP_HOME.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'mlp.js');
const FIXTURES = path.join(__dirname, 'fixtures');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mlp-test-' + (prefix || '') + '-'));
}

function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
}

// Fresh MLP_HOME with the fixture lessons copied in.
function makeHome(opts) {
  const home = tmpDir('home');
  const lessons = path.join(home, 'lessons');
  fs.mkdirSync(lessons, { recursive: true });
  const only = opts && opts.only;
  for (const f of fs.readdirSync(path.join(FIXTURES, 'lessons'))) {
    if (only && !only.includes(f.replace(/\.md$/, ''))) continue;
    fs.copyFileSync(path.join(FIXTURES, 'lessons', f), path.join(lessons, f));
  }
  return home;
}

function runCli(args, opts) {
  const o = opts || {};
  const env = Object.assign({}, process.env, { MLP_HOME: o.home, MLP_DISABLE: '' }, o.env || {});
  delete env.MLP_DEBUG;
  const r = spawnSync(process.execPath, [BIN].concat(args), {
    input: o.input, encoding: 'utf8', env, cwd: o.cwd || os.tmpdir(), timeout: 20000,
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function runHook(kind, input, opts) {
  const o = opts || {};
  const r = runCli(['hook', kind], { home: o.home, env: o.env, cwd: o.cwd, input: JSON.stringify(input) });
  let json = null;
  if (r.stdout.trim()) json = JSON.parse(r.stdout);
  return Object.assign(r, { json });
}

module.exports = { ROOT, BIN, FIXTURES, tmpDir, rmDir, makeHome, runCli, runHook };
