'use strict';
// Install / uninstall merge logic for Claude Code settings.json (SPEC section 7).
const fs = require('fs');
const path = require('path');

const MARK = 'multi-lesson-path';
const OURS_RE = /mlp\.js"?\s+hook\s+(?:prompt|edit|post-tool|session-start|session-end)\b/;

const HOOKS = [
  { event: 'UserPromptSubmit', kind: 'prompt', matcher: null, timeout: 5 },
  { event: 'PreToolUse', kind: 'edit', matcher: 'Edit|Write|MultiEdit|NotebookEdit', timeout: 5 },
  { event: 'PostToolUse', kind: 'post-tool', matcher: 'Bash|PowerShell', timeout: 5 },
  { event: 'SessionStart', kind: 'session-start', matcher: null, timeout: 5 },
  { event: 'SessionEnd', kind: 'session-end', matcher: null, timeout: 10 },
];

const slashes = (p) => String(p).replace(/\\/g, '/');

function hookCommand(appDir, kind) {
  return 'node "' + slashes(path.resolve(appDir, 'bin', 'mlp.js')) + '" hook ' + kind;
}

function isOurs(hook) {
  const c = hook && typeof hook.command === 'string' ? hook.command : '';
  return c.includes(MARK) || OURS_RE.test(c);
}

function buildEntry(def, appDir) {
  const entry = {};
  if (def.matcher) entry.matcher = def.matcher;
  entry.hooks = [{ type: 'command', command: hookCommand(appDir, def.kind), timeout: def.timeout }];
  return entry;
}

function readSettings(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
  raw = raw.replace(/^﻿/, '');
  if (!raw.trim()) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) {
    throw new Error('cannot parse ' + file + ': ' + e.message + ' (not touching it)');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(file + ' is not a JSON object');
  return parsed;
}

// Remove our hook objects from an event array. Returns the index of the first
// entry that contained one (or -1) so the replacement can take its place.
function stripOurs(arr) {
  let firstIndex = -1;
  const result = [];
  arr.forEach((entry) => {
    if (!entry || !Array.isArray(entry.hooks)) { result.push(entry); return; }
    const kept = entry.hooks.filter((h) => !isOurs(h));
    if (kept.length === entry.hooks.length) { result.push(entry); return; }
    if (firstIndex < 0) firstIndex = result.length;
    if (kept.length) result.push(Object.assign({}, entry, { hooks: kept }));
  });
  return { result, firstIndex };
}

function mergeInstall(settings, appDir) {
  const next = JSON.parse(JSON.stringify(settings || {}));
  if (!next.hooks || typeof next.hooks !== 'object' || Array.isArray(next.hooks)) next.hooks = {};
  for (const def of HOOKS) {
    const existing = Array.isArray(next.hooks[def.event]) ? next.hooks[def.event] : [];
    const { result, firstIndex } = stripOurs(existing);
    const entry = buildEntry(def, appDir);
    if (firstIndex >= 0) result.splice(firstIndex, 0, entry);
    else result.push(entry);
    next.hooks[def.event] = result;
  }
  return next;
}

function mergeUninstall(settings) {
  const next = JSON.parse(JSON.stringify(settings || {}));
  if (!next.hooks || typeof next.hooks !== 'object') return next;
  for (const event of Object.keys(next.hooks)) {
    if (!Array.isArray(next.hooks[event])) continue;
    const { result } = stripOurs(next.hooks[event]);
    if (result.length) next.hooks[event] = result;
    else delete next.hooks[event];
  }
  if (!Object.keys(next.hooks).length) delete next.hooks;
  return next;
}

// Which of our hook kinds are present: { prompt: command, ... }
function findInstalled(settings) {
  const found = {};
  const hooks = settings && settings.hooks;
  if (!hooks) return found;
  for (const def of HOOKS) {
    for (const entry of Array.isArray(hooks[def.event]) ? hooks[def.event] : []) {
      for (const h of (entry && Array.isArray(entry.hooks)) ? entry.hooks : []) {
        if (isOurs(h) && new RegExp('\\bhook ' + def.kind + '\\s*$').test(h.command)) found[def.kind] = h.command;
      }
    }
  }
  return found;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

function writeSettings(file, settings, backup) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backupFile = null;
  if (backup && fs.existsSync(file)) {
    backupFile = file + '.bak-mlp-' + timestamp();
    fs.copyFileSync(file, backupFile);
  }
  const tmp = file + '.tmp-mlp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return backupFile;
}

function install(file, appDir) {
  const before = readSettings(file);
  const after = mergeInstall(before, appDir);
  if (JSON.stringify(before) === JSON.stringify(after) && fs.existsSync(file)) return { changed: false, backup: null };
  return { changed: true, backup: writeSettings(file, after, true) };
}

function uninstall(file) {
  if (!fs.existsSync(file)) return { changed: false, backup: null };
  const before = readSettings(file);
  const after = mergeUninstall(before);
  if (JSON.stringify(before) === JSON.stringify(after)) return { changed: false, backup: null };
  return { changed: true, backup: writeSettings(file, after, true) };
}

module.exports = {
  MARK, HOOKS, hookCommand, isOurs, readSettings, writeSettings, mergeInstall, mergeUninstall,
  findInstalled, install, uninstall,
};
