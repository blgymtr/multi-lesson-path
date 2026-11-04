'use strict';
// Per-session de-duplication state: state/<sessionId>.json
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const safe = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
const fileFor = (session) => path.join(paths.stateDir(), safe(session) + '.json');

function load(session) {
  if (!session) return { shown: [] };
  try {
    const s = JSON.parse(fs.readFileSync(fileFor(session), 'utf8'));
    if (s && Array.isArray(s.shown)) return s;
  } catch (e) { /* none yet */ }
  return { shown: [] };
}

function markShown(session, ids) {
  if (!session || !ids.length) return;
  const s = load(session);
  for (const id of ids) if (!s.shown.includes(id)) s.shown.push(id);
  s.updated = new Date().toISOString();
  fs.mkdirSync(paths.stateDir(), { recursive: true });
  fs.writeFileSync(fileFor(session), JSON.stringify(s));
}

function reset(session) {
  if (!session) return;
  try { fs.unlinkSync(fileFor(session)); } catch (e) { /* nothing to reset */ }
}

// Delete state files older than maxAgeDays (default 7).
function prune(maxAgeDays) {
  const cutoff = Date.now() - (maxAgeDays || 7) * 86400000;
  let removed = 0;
  let names;
  try { names = fs.readdirSync(paths.stateDir()); } catch (e) { return 0; }
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    const f = path.join(paths.stateDir(), n);
    try {
      if (fs.statSync(f).mtimeMs < cutoff) { fs.unlinkSync(f); removed++; }
    } catch (e) { /* ignore */ }
  }
  return removed;
}

module.exports = { load, markShown, reset, prune, fileFor };
