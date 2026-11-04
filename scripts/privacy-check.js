#!/usr/bin/env node
'use strict';
// Refuses commits that contain personal data (SPEC section 10).
//   node scripts/privacy-check.js [paths...]     (no args: files staged for commit)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SAFE_NAMES = new Set(['alice', 'bob', 'user', 'users', 'runner', 'username', 'name', 'you', 'me', 'public', 'default', 'example', 'yourname']);
const SEP = '(?:\\\\\\\\|\\\\|/)+';
const WIN_RE = new RegExp('[A-Za-z]:' + SEP + 'Users' + SEP + '([^\\\\/\\s"\'`<>|:*?,;()\\[\\]{}]+)', 'gi');
const NIX_RE = new RegExp('(?:^|[^A-Za-z0-9_.~:-])/(?:Users|home)/([^/\\\\\\s"\'`<>|:*?,;()\\[\\]{}]+)', 'gi');
const MAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

function safeName(n) {
  const name = n.toLowerCase();
  return SAFE_NAMES.has(name) || /^[<%$@{*.]/.test(n) || /[>%}]$/.test(n);
}

function denylist() {
  try {
    const home = process.env.MLP_HOME || path.join(os.homedir(), '.claude', 'multi-lesson-path');
    return fs.readFileSync(path.join(home, 'privacy-denylist.txt'), 'utf8').split(/\r?\n/)
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch (e) { return []; }
}

function scanText(text, deny) {
  const findings = [];
  const lines = text.split(/\r?\n/);
  const lowerDeny = deny.map((d) => d.toLowerCase());
  lines.forEach((line, i) => {
    if (line.length > 20000) line = line.slice(0, 20000);
    let m;
    for (const re of [WIN_RE, NIX_RE]) {
      re.lastIndex = 0;
      while ((m = re.exec(line))) {
        if (!safeName(m[1])) findings.push({ line: i + 1, kind: 'home path', text: m[0].trim() });
      }
    }
    MAIL_RE.lastIndex = 0;
    while ((m = MAIL_RE.exec(line))) {
      const addr = m[0].toLowerCase();
      const [local, domain] = addr.split('@');
      if (local === 'noreply' || local === 'git' || domain === 'example.com' || domain.endsWith('.example.com')) continue;
      findings.push({ line: i + 1, kind: 'e-mail address', text: m[0] });
    }
    const low = line.toLowerCase();
    lowerDeny.forEach((d, n) => { if (low.includes(d)) findings.push({ line: i + 1, kind: 'deny-list entry #' + (n + 1), text: '(hidden)' }); });
  });
  return findings;
}

function looksBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

function stagedFiles(cwd) {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function readStaged(cwd, file) {
  return execFileSync('git', ['show', ':' + file], { cwd, maxBuffer: 20 * 1024 * 1024 });
}

// Returns an exit code (0 clean, 1 findings, 2 usage problem).
function run(args, io) {
  const out = (io && io.out) || console.log;
  const err = (io && io.err) || console.error;
  const cwd = (io && io.cwd) || process.cwd();
  const deny = denylist();
  const items = []; // { label, buf }
  try {
    if (args.length) {
      for (const f of args) {
        const p = path.resolve(cwd, f);
        let st;
        try { st = fs.statSync(p); } catch (e) { err('privacy-check: cannot read ' + f); return 2; }
        const files = st.isDirectory() ? walk(p) : [p];
        for (const file of files) items.push({ label: path.relative(cwd, file) || file, read: () => fs.readFileSync(file) });
      }
    } else {
      const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
      for (const f of stagedFiles(top)) items.push({ label: f, read: () => readStaged(top, f) });
    }
  } catch (e) {
    err('privacy-check: ' + (e.message || e));
    return 2;
  }
  let bad = 0;
  let scanned = 0;
  for (const it of items) {
    let buf;
    try { buf = it.read(); } catch (e) { continue; }
    if (buf.length > 2 * 1024 * 1024 || looksBinary(buf)) continue;
    scanned++;
    for (const f of scanText(buf.toString('utf8'), deny)) {
      if (!bad) err('privacy-check: personal data found, refusing.');
      bad++;
      err('  ' + it.label + ':' + f.line + '  ' + f.kind + '  ' + f.text);
    }
  }
  if (bad) {
    err(bad + ' problem(s). Replace real names/paths with placeholders (alice, /home/alice/project) and try again.');
    return 1;
  }
  out('privacy-check: ' + scanned + ' file(s) clean.');
  return 0;
}

function walk(dir) {
  const res = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) res.push(...walk(p));
    else res.push(p);
  }
  return res;
}

module.exports = { run, scanText };

if (require.main === module) process.exitCode = run(process.argv.slice(2));
