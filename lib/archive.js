'use strict';
// Condensed gzip archive of Claude Code transcripts (so they survive cleanupPeriodDays).
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { readTranscript, listTranscripts, expandHome } = require('./transcripts');

/** Directory layout under the data home (SPEC section 3). Self-contained: only the default home comes from lib/paths.js. */
function resolvePaths(home) {
  let h = home || process.env.MLP_HOME;
  if (!h) {
    try { h = require('./paths').home(); } catch (e) { h = null; }
  }
  h = path.resolve(h || path.join(os.homedir(), '.claude', 'multi-lesson-path'));
  return {
    home: h, app: path.join(h, 'app'), lessons: path.join(h, 'lessons'), drafts: path.join(h, 'drafts'),
    candidates: path.join(h, 'candidates'), archive: path.join(h, 'archive'), state: path.join(h, 'state'),
    hits: path.join(h, 'hits.jsonl'), feedback: path.join(h, 'feedback.jsonl'), config: path.join(h, 'config.json'),
    disabled: path.join(h, 'disabled')
  };
}

function loadConfig(home) {
  const p = resolvePaths(home);
  let f = p.config;
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'config.json'); } catch (e) { return {}; }
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) || {}; } catch (e) { return {}; }
}

function transcriptRoots(home, override) {
  let roots = override;
  if (!roots || !roots.length) roots = loadConfig(home).transcriptRoots;
  if (!roots || !roots.length) roots = ['~/.claude/projects'];
  return roots.map(expandHome);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run fn while holding an exclusive lock file (stale after 30 s). */
async function withLock(file, fn) {
  const lock = file + '.lock';
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'EPERM' && e.code !== 'EACCES') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 30000) { fs.unlinkSync(lock); continue; }
      } catch (e2) { /* released meanwhile */ }
      if (Date.now() > deadline) { try { fs.unlinkSync(lock); } catch (e3) { /* ignore */ } continue; }
      await sleep(25 + Math.floor(Math.random() * 50));
    }
  }
  try { return await fn(); } finally { try { fs.unlinkSync(lock); } catch (e) { /* ignore */ } }
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp';
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    // Windows can refuse to overwrite while a reader has the file open: retry briefly.
    for (let i = 0; i < 20; i++) {
      try { fs.renameSync(tmp, file); return; } catch (e2) { /* retry */ }
      const t = Date.now(); while (Date.now() - t < 20) { /* spin */ }
    }
    try { fs.unlinkSync(tmp); } catch (e3) { /* ignore */ }
    throw e;
  }
}

/** Atomic read-modify-write of a JSON file under a lock. mutator(obj) may return a replacement. */
async function updateJson(file, fallback, mutator) {
  return withLock(file, async () => {
    const cur = readJson(file, null) || fallback;
    const next = (await mutator(cur)) || cur;
    writeAtomic(file, JSON.stringify(next, null, 1));
    return next;
  });
}

function safeSlug(s) {
  return String(s || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120) || 'unknown';
}

function loadIndex(home) {
  const idx = readJson(path.join(resolvePaths(home).archive, 'index.json'), null);
  if (!idx || typeof idx !== 'object' || !idx.sessions) return { version: 1, sessions: {} };
  return idx;
}

/**
 * Archive one transcript. Returns { status: 'archived'|'skipped'|'empty', sessionId, file?, events? }.
 */
async function archiveSession(file, opts) {
  opts = opts || {};
  const p = resolvePaths(opts.home);
  const st = fs.statSync(file);
  const sessionId = path.basename(file, '.jsonl');
  const idxFile = path.join(p.archive, 'index.json');
  const prev = (loadIndex(opts.home).sessions || {})[sessionId];
  if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs && prev.source === path.resolve(file) && (!opts.full || prev.full)
      && fs.existsSync(path.join(p.archive, prev.file || ''))) {
    return { status: 'skipped', sessionId };
  }
  const t = await readTranscript(file);
  if (!t.events.length) return { status: 'empty', sessionId };
  const slug = safeSlug(t.slug);
  const rel = slug + '/' + safeSlug(sessionId) + '.jsonl.gz';
  const dest = path.join(p.archive, slug, safeSlug(sessionId) + '.jsonl.gz');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp';
  try {
    if (opts.full) {
      await pipeline(fs.createReadStream(file), zlib.createGzip({ level: 6 }), fs.createWriteStream(tmp));
    } else {
      const meta = { sessionId: t.sessionId || sessionId, title: t.title, summary: t.summary, cwd: t.cwd, project: t.project, slug: t.slug, start: t.start, end: t.end };
      const lines = [JSON.stringify({ meta })];
      for (const e of t.events) lines.push(JSON.stringify(e));
      fs.writeFileSync(tmp, zlib.gzipSync(lines.join('\n') + '\n', { level: 9 }));
    }
    try {
      fs.renameSync(tmp, dest);
    } catch (e) {
      fs.copyFileSync(tmp, dest);
      fs.unlinkSync(tmp);
    }
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* ignore */ }
    throw e;
  }
  const entry = {
    source: path.resolve(file), size: st.size, mtimeMs: st.mtimeMs, archivedAt: new Date().toISOString(),
    events: t.events.length, file: rel, full: !!opts.full, project: t.project || null, cwd: t.cwd || null,
    title: t.title || null, start: t.start, end: t.end
  };
  await updateJson(idxFile, { version: 1, sessions: {} }, (idx) => {
    if (!idx.sessions) idx.sessions = {};
    idx.version = 1;
    idx.sessions[sessionId] = entry;
    return idx;
  });
  return { status: 'archived', sessionId, file: dest, events: entry.events };
}

/** Archive every transcript under the roots that is new or changed. */
async function archiveAll(opts) {
  opts = opts || {};
  const roots = transcriptRoots(opts.home, opts.roots);
  const list = listTranscripts(roots);
  const stats = { total: list.length, archived: 0, skipped: 0, empty: 0, failed: 0 };
  for (const it of list) {
    try {
      const r = await archiveSession(it.file, { home: opts.home, full: opts.full });
      stats[r.status] = (stats[r.status] || 0) + 1;
      if (opts.onProgress) opts.onProgress(it, r);
    } catch (e) {
      stats.failed++;
      if (opts.onProgress) opts.onProgress(it, { status: 'failed', error: e.message });
    }
  }
  return stats;
}

/** Tiny arg parser: spec = { bool: ['all'], str: ['transcript'] }; returns { flags, rest }. */
function parseArgs(args, spec) {
  const bool = new Set((spec && spec.bool) || []);
  const str = new Set((spec && spec.str) || []);
  const flags = {}; const rest = [];
  for (let i = 0; i < (args || []).length; i++) {
    const a = args[i];
    if (a.startsWith('--') && a.length > 2) {
      let k = a.slice(2); let v = null;
      const eq = k.indexOf('=');
      if (eq >= 0) { v = k.slice(eq + 1); k = k.slice(0, eq); }
      if (bool.has(k)) flags[k] = true;
      else if (str.has(k)) { if (v === null) v = args[++i]; if (v === undefined) throw new Error('--' + k + ' needs a value'); flags[k] = v; }
      else throw new Error('unknown option: --' + k);
    } else rest.push(a);
  }
  return { flags, rest };
}

module.exports = { parseArgs, archiveSession, archiveAll, loadIndex, resolvePaths, loadConfig, transcriptRoots, withLock, updateJson, writeAtomic, readJson, safeSlug };
