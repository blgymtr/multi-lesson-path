'use strict';
// Hook entry points (SPEC section 6). Must never break the user's action and must
// stay fast: no capture modules are loaded here.
const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const FAILED = /error|failed|not found|exception|traceback|cannot|denied|exit code [1-9]|non-zero/i;
// Stricter, per-line test used to pick the lines that report the failure.
const LINE_FAILED = /\berror\b|\berr!|\bfailed\b|\bfatal\b|not found|exception|traceback|cannot |permission denied|access is denied|exit code [1-9]|non-zero|is not recognized/i;
const EVENT_NAMES = {
  prompt: 'UserPromptSubmit',
  edit: 'PreToolUse',
  'post-tool': 'PostToolUse',
  'session-start': 'SessionStart',
};
const LABELS = { prompt: 'task', edit: 'file', 'post-tool': 'error', 'session-start': 'task' };
const KINDS = ['prompt', 'edit', 'post-tool', 'session-start', 'session-end'];

function isDisabled() {
  if (process.env.MLP_DISABLE === '1') return true;
  try { return fs.existsSync(paths.disabledFile()); } catch (e) { return false; }
}

function logError(kind, err) {
  try {
    if (!fs.existsSync(paths.home())) return;
    const f = paths.hookErrorLog();
    try { if (fs.statSync(f).size > 200000) fs.truncateSync(f, 0); } catch (e) { /* new file */ }
    fs.appendFileSync(f, new Date().toISOString() + ' ' + kind + ' ' + (err && err.stack || err) + '\n');
  } catch (e) { /* never throw from the error logger */ }
}

function str(v) { return typeof v === 'string' ? v : ''; }

function stringifyResponse(r) {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (typeof r === 'object') {
    const parts = [];
    for (const k of ['stdout', 'stderr', 'output', 'error', 'content', 'text']) {
      if (typeof r[k] === 'string' && r[k]) parts.push(r[k]);
    }
    if (parts.length) return parts.join('\n');
    try { return JSON.stringify(r); } catch (e) { return ''; }
  }
  return String(r);
}

function editText(ti) {
  const parts = [];
  for (const k of ['new_string', 'content', 'new_source']) if (typeof ti[k] === 'string') parts.push(ti[k]);
  if (Array.isArray(ti.edits)) for (const e of ti.edits) if (e && typeof e.new_string === 'string') parts.push(e.new_string);
  return parts.join('\n').slice(0, 4000);
}

function respond(kind, ctx, matches, input, extra) {
  const { buildContext } = require('./format');
  const state = require('./state');
  const log = require('./log');
  const cfg = paths.loadConfig();
  const session = str(input.session_id);
  let items = matches;
  if (session) {
    const shown = new Set(state.load(session).shown);
    items = items.filter((m) => !shown.has(m.lesson.id));
  }
  if (!items.length) return null;
  const built = buildContext(LABELS[kind], items, {
    maxLessons: cfg.maxLessons, bodyChars: cfg.bodyChars, maxChars: cfg.maxChars,
  });
  if (!built) return null;
  if (session) state.markShown(session, built.used.map((m) => m.lesson.id));
  for (const m of built.used) {
    try {
      log.appendHit({
        event: kind, lesson: m.lesson.id, session: session || null, cwd: ctx.cwd || null,
        file: (extra && extra.file) || null, reasons: m.reasons,
      });
    } catch (e) { logError(kind, e); }
  }
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: EVENT_NAMES[kind], additionalContext: built.text },
  });
}

function loadForMatching(cwd) {
  const lessons = require('./lessons');
  return lessons.loadAll({ cwd }).filter(lessons.isActive);
}

// Prompts are not always typed by the user: harness notifications and reports from
// sub-agents arrive through UserPromptSubmit too. Remove those blocks (and anything that
// quotes our own injected context) so only the user's own words are matched.
const MACHINE_BLOCKS = [
  /<system-reminder[\s\S]*?<\/system-reminder[^>]*>/gi,
  /<task-notification[\s\S]*?<\/task-notification>/gi,
  /<agent-message[\s\S]*?<\/agent-message>/gi,
  /<(local-command-[a-z]+|command-[a-z]+|bash-[a-z]+)>[\s\S]*?<\/\1>/gi,
];
const MACHINE_PREFIX = /^\s*(Another Claude session sent a message|\[SYSTEM NOTIFICATION|\[Subagent hand-back\])/i;

function userText(prompt) {
  if (MACHINE_PREFIX.test(prompt)) return '';
  let t = prompt;
  for (const re of MACHINE_BLOCKS) t = t.replace(re, ' ');
  return t.replace(/\[multi-lesson-path\][\s\S]*/i, ' ');
}

function handlePrompt(input) {
  const prompt = userText(str(input.prompt));
  if (!prompt.trim()) return null;
  const cwd = str(input.cwd) || process.cwd();
  const { evaluate } = require('./match');
  const matches = evaluate(loadForMatching(cwd), {
    text: prompt, cwd, strictProjects: false, feedback: require('./log').feedbackCounts(),
  });
  return respond('prompt', { cwd }, matches, input);
}

function handleEdit(input) {
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const file = str(ti.file_path) || str(ti.notebook_path) || str(ti.path);
  if (!file) return null;
  const cwd = str(input.cwd) || process.cwd();
  const { evaluate } = require('./match');
  const matches = evaluate(loadForMatching(cwd), {
    file, text: editText(ti), cwd, strictProjects: true, feedback: require('./log').feedbackCounts(),
  });
  return respond('edit', { cwd }, matches, input, { file });
}

function handlePostTool(input) {
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const resp = input.tool_response;
  const out = stringifyResponse(resp).slice(0, 6000);
  const flagged = resp && typeof resp === 'object' && (resp.is_error === true || resp.isError === true || resp.interrupted === true);
  if (!flagged && !FAILED.test(out)) return null;
  const cwd = str(input.cwd) || process.cwd();
  // Keyword matching only looks at the command and the lines that actually report a
  // failure (only those lines: the next line is often unrelated output), never at arbitrary output text,
  // which can contain anything (file contents, logs, other lessons).
  const lines = out.split(/\r?\n/);
  const errLines = [];
  for (let i = 0; i < lines.length && errLines.length < 40; i++) {
    if (LINE_FAILED.test(lines[i])) errLines.push(lines[i]);
  }
  const errText = flagged && !errLines.length ? out.slice(0, 1500) : errLines.join('\n');
  const { evaluate } = require('./match');
  const matches = evaluate(loadForMatching(cwd), {
    // literal `errors:` strings are specific, so they may match anywhere in the output
    error: out, text: str(ti.command) + '\n' + errText, cwd, strictProjects: true,
    feedback: require('./log').feedbackCounts(),
  });
  return respond('post-tool', { cwd }, matches, input);
}

function handleSessionStart(input) {
  const cwd = str(input.cwd) || process.cwd();
  const state = require('./state');
  const session = str(input.session_id);
  const source = str(input.source);
  if (source === 'compact' || source === 'clear') state.reset(session);
  try { state.prune(7); } catch (e) { /* housekeeping only */ }
  const { alwaysMatches } = require('./match');
  const cfg = paths.loadConfig();
  const matches = alwaysMatches(loadForMatching(cwd), cwd, require('./log').feedbackCounts(), Math.min(3, cfg.maxLessons || 3));
  return respond('session-start', { cwd }, matches, input);
}

function handleSessionEnd(input) {
  const transcript = str(input.transcript_path);
  if (!transcript) return null;
  const { spawn } = require('child_process');
  const bin = path.join(paths.APP_ROOT, 'bin', 'mlp.js');
  const child = spawn(process.execPath, [bin, '--home', paths.home(), 'archive', '--transcript', transcript], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: Object.assign({}, process.env, { MLP_HOME: paths.home() }),
  });
  child.on('error', () => { /* archive is best effort */ });
  child.unref();
  return null;
}

const HANDLERS = {
  prompt: handlePrompt,
  edit: handleEdit,
  'post-tool': handlePostTool,
  'session-start': handleSessionStart,
  'session-end': handleSessionEnd,
};

/** Returns the JSON string to print, or null. Never throws. */
function handle(kind, input) {
  try {
    if (!HANDLERS[kind] || isDisabled()) return null;
    const data = input && typeof input === 'object' ? input : {};
    return HANDLERS[kind](data);
  } catch (e) {
    logError(kind, e);
    return null;
  }
}

function parseInput(text) {
  try {
    const t = String(text || '').replace(/^﻿/, '').trim();
    return t ? JSON.parse(t) : {};
  } catch (e) { return {}; }
}

module.exports = { handle, parseInput, isDisabled, stringifyResponse, KINDS, EVENT_NAMES, FAILED };
