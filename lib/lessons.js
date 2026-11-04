'use strict';
// Lesson files: parse / serialize / load / lint (SPEC section 4).
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { isValidGlob } = require('./glob');
const { tokenize } = require('./normalize');

const KNOWN_KEYS = ['id', 'title', 'keywords', 'strong', 'min_match', 'engines', 'paths', 'errors',
  'projects', 'always', 'created', 'verified', 'source', 'status'];
const LIST_KEYS = new Set(['keywords', 'strong', 'engines', 'paths', 'errors', 'projects']);
const STATUSES = ['active', 'draft', 'retired'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function splitList(v) {
  return String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function emptyLesson(file) {
  return {
    id: '', title: '', keywords: [], strong: [], minMatch: null, engines: [], paths: [], errors: [],
    projects: [], always: false, created: '', verified: '', source: '', status: 'active', body: '',
    file: file || '', scope: 'global', issues: [],
  };
}

function parseLessonFile(text, file) {
  const l = emptyLesson(file);
  const src = String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(src);
  if (!m) {
    l.issues.push({ level: 'error', msg: 'missing front matter block (--- ... ---)' });
    l.body = src.trim();
    return l;
  }
  l.body = src.slice(m[0].length).trim();
  const lines = (m[1] || '').split('\n');
  const seen = new Set();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const ix = line.indexOf(':');
    if (ix < 1) { l.issues.push({ level: 'error', msg: 'front matter line without "key: value": ' + line.slice(0, 40) }); continue; }
    const key = line.slice(0, ix).trim().toLowerCase();
    const val = line.slice(ix + 1).trim();
    if (!KNOWN_KEYS.includes(key)) { l.issues.push({ level: 'error', msg: 'unknown key "' + key + '"' }); continue; }
    if (seen.has(key)) l.issues.push({ level: 'warning', msg: 'duplicate key "' + key + '"' });
    seen.add(key);
    if (LIST_KEYS.has(key)) {
      l[key] = splitList(val);
      if (key === 'engines') l.engines = l.engines.map((e) => e.toLowerCase());
    } else if (key === 'min_match') {
      if (val === '') continue;
      if (/^\d+$/.test(val) && Number(val) >= 1) l.minMatch = Number(val);
      else l.issues.push({ level: 'error', msg: 'min_match must be a positive integer, got "' + val + '"' });
    } else if (key === 'always') {
      const v = val.toLowerCase();
      if (['true', 'yes', '1'].includes(v)) l.always = true;
      else if (['false', 'no', '0', ''].includes(v)) l.always = false;
      else l.issues.push({ level: 'error', msg: 'always must be true or false, got "' + val + '"' });
    } else if (key === 'status') {
      const v = (val || 'active').toLowerCase();
      if (!STATUSES.includes(v)) l.issues.push({ level: 'error', msg: 'status must be active, draft or retired, got "' + val + '"' });
      l.status = v;
    } else {
      l[key] = val;
    }
  }
  return l;
}

const oneLine = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
const listLine = (key, arr) => (key + ': ' + (arr || []).map(oneLine).join(', ')).trimEnd();

function serializeLesson(l) {
  const out = ['---'];
  out.push(('id: ' + oneLine(l.id)).trimEnd());
  out.push(('title: ' + oneLine(l.title)).trimEnd());
  out.push(listLine('keywords', l.keywords));
  out.push(listLine('strong', l.strong));
  if (l.minMatch != null) out.push('min_match: ' + l.minMatch);
  out.push(listLine('engines', l.engines));
  out.push(listLine('paths', l.paths));
  out.push(listLine('errors', l.errors));
  out.push(listLine('projects', l.projects));
  out.push('always: ' + (l.always ? 'true' : 'false'));
  out.push(('created: ' + oneLine(l.created)).trimEnd());
  out.push(('verified: ' + oneLine(l.verified)).trimEnd());
  if (l.source) out.push('source: ' + oneLine(l.source));
  if (l.status && l.status !== 'active') out.push('status: ' + l.status);
  out.push('---');
  return out.join('\n') + '\n' + String(l.body || '').trim() + '\n';
}

// Replace (or insert) one "key: value" line inside the front matter, leaving
// the rest of the file byte-for-byte intact.
function setFrontMatterKey(text, key, value) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const m = /^(﻿?---[ \t]*\r?\n)((?:[\s\S]*?\r?\n)?)(---[ \t]*(?:\r?\n|$))/.exec(text);
  if (!m) throw new Error('no front matter block');
  const re = new RegExp('^' + key + '[ \\t]*:.*$', 'mi');
  let fm = m[2];
  if (re.test(fm)) fm = fm.replace(re, key + ': ' + value);
  else fm += key + ': ' + value + nl;
  return m[1] + fm + m[3] + text.slice(m[0].length);
}

const CACHE_VERSION = 1;
const cacheFile = () => path.join(paths.home(), 'lessons-cache.json');

// Parsed lessons are cached by (mtime, size): stat is ~6x cheaper than reading 300 files,
// which keeps the prompt hook fast. The cache is best effort and safe to delete.
function readCache() {
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    if (c && c.v === CACHE_VERSION && c.files && typeof c.files === 'object') return { files: c.files, dirty: false };
  } catch (e) { /* no cache yet */ }
  return { files: {}, dirty: false };
}

function flushCache(cache) {
  if (!cache.dirty) return;
  try {
    if (!fs.existsSync(paths.home())) return;
    const tmp = cacheFile() + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: CACHE_VERSION, files: cache.files }));
    fs.renameSync(tmp, cacheFile());
  } catch (e) { /* cache is optional */ }
}

function loadDir(dir, scope, cache) {
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  const out = [];
  const seen = new Set();
  for (const name of names.sort()) {
    if (!name.toLowerCase().endsWith('.md')) continue;
    const file = path.join(dir, name);
    let l = null;
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) continue;
      const ent = cache && cache.files[file];
      if (ent && ent.m === st.mtimeMs && ent.s === st.size) {
        l = ent.l;
      } else {
        l = parseLessonFile(fs.readFileSync(file, 'utf8'), file);
        if (cache) { cache.files[file] = { m: st.mtimeMs, s: st.size, l }; cache.dirty = true; }
      }
    } catch (e) { continue; }
    seen.add(file);
    l.scope = scope;
    out.push(l);
  }
  if (cache) {
    for (const f of Object.keys(cache.files)) {
      if (path.dirname(f) === dir && !seen.has(f)) { delete cache.files[f]; cache.dirty = true; }
    }
  }
  return out;
}

// .lessons directories found walking up from cwd (max 8 levels, stop at .git).
function findLocalDirs(cwd) {
  const found = [];
  if (!cwd) return found;
  let dir = path.resolve(cwd);
  for (let i = 0; i < 8; i++) {
    const cand = path.join(dir, '.lessons');
    try { if (fs.statSync(cand).isDirectory()) found.push(cand); } catch (e) { /* none */ }
    if (fs.existsSync(path.join(dir, '.git'))) break;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return found;
}

// All lessons: global first, then project-local ones (ids prefixed "local:" on collision).
// Entries with no id are kept (lint needs them); use isUsable() before matching.
function loadAll(opts) {
  const o = opts || {};
  const globalDir = o.dir || paths.lessonsDir();
  const cache = o.cache === false ? null : readCache();
  const all = loadDir(globalDir, 'global', cache);
  const locals = (o.cwd ? findLocalDirs(o.cwd) : []).map((d) => loadDir(d, 'local', cache));
  flushCache(cache || { dirty: false }); // before ids are rewritten below
  const ids = new Set(all.map((l) => l.id).filter(Boolean));
  for (const list of locals) {
    for (const l of list) {
      l.origId = l.id;
      if (l.id && ids.has(l.id)) l.id = 'local:' + l.id;
      if (l.id) ids.add(l.id);
      all.push(l);
    }
  }
  return all;
}

const isUsable = (l) => Boolean(l.id && l.body);
const isActive = (l) => isUsable(l) && l.status === 'active';

function findById(lessons, id) {
  return lessons.find((l) => l.id === id) || lessons.find((l) => l.origId === id) || null;
}

function lintLesson(l) {
  const errors = [];
  const warnings = [];
  for (const i of l.issues || []) (i.level === 'error' ? errors : warnings).push(i.msg);
  if (!l.id) errors.push('missing id');
  else if (!SLUG.test(String(l.origId || l.id).replace(/^local:/, ''))) errors.push('id "' + l.id + '" is not a slug [a-z0-9-]+');
  if (!l.title) errors.push('missing title');
  if (!l.body) errors.push('empty body');
  for (const g of l.paths || []) if (!isValidGlob(g)) errors.push('invalid glob "' + g + '"');
  for (const g of l.paths || []) if (/^[*/?]+$/.test(g)) warnings.push('glob "' + g + '" matches almost every file');
  for (const k of [].concat(l.keywords || [], l.strong || [])) {
    if (!tokenize(k.replace(/^=/, '')).length) warnings.push('keyword "' + k + '" has no searchable characters');
  }
  const hasTrigger = l.keywords.length || l.strong.length || l.paths.length || l.errors.length || l.always;
  if (!hasTrigger) warnings.push('no triggers (keywords, strong, paths, errors or always)');
  if (l.minMatch != null && !l.strong.length && l.minMatch > l.keywords.length) {
    warnings.push('min_match ' + l.minMatch + ' is larger than the number of keywords (' + l.keywords.length + '); text will never fire');
  }
  for (const f of ['created', 'verified']) if (l[f] && !ISO_DATE.test(l[f])) warnings.push(f + ' "' + l[f] + '" is not an ISO date');
  if (l.file && l.scope === 'global' && l.id) {
    const base = path.basename(l.file, path.extname(l.file));
    if (base !== l.id) warnings.push('file name "' + path.basename(l.file) + '" does not match id "' + l.id + '"');
  }
  if (l.body && l.body.replace(/\s+/g, ' ').length > 600) warnings.push('body is longer than 600 chars; it will be truncated when injected');
  return { errors, warnings };
}

// Lint every lesson plus cross-file checks (duplicate ids).
function lintAll(lessons) {
  const results = lessons.map((l) => Object.assign({ lesson: l }, lintLesson(l)));
  const byId = new Map();
  for (const r of results) {
    const id = r.lesson.origId || r.lesson.id;
    if (!id) continue;
    const key = (r.lesson.scope === 'global' ? 'g:' : 'l:') + id;
    if (byId.has(key)) {
      r.errors.push('duplicate id "' + id + '" (also in ' + byId.get(key).lesson.file + ')');
    } else byId.set(key, r);
    if (r.lesson.scope === 'local' && r.lesson.origId && r.lesson.id !== r.lesson.origId) {
      r.warnings.push('id "' + r.lesson.origId + '" collides with a global lesson; shown as "' + r.lesson.id + '"');
    }
  }
  return results;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = {
  KNOWN_KEYS, STATUSES, SLUG, parseLessonFile, serializeLesson, setFrontMatterKey, loadDir,
  findLocalDirs, loadAll, isUsable, isActive, findById, lintLesson, lintAll, emptyLesson, today,
};
