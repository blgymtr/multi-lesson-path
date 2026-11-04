'use strict';
// Find failure -> fix episodes in archived / live transcripts and write candidate digests.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readTranscript, readArchived, listTranscripts } = require('./transcripts');
const { resolvePaths, loadConfig, transcriptRoots, loadIndex, updateJson, readJson, writeAtomic } = require('./archive');

let normalizeFn = null;
try { normalizeFn = require('./normalize').normalize; } catch (e) { normalizeFn = null; }

function fold(text) {
  let s = String(text == null ? '' : text);
  if (normalizeFn) {
    try { s = String(normalizeFn(s)); } catch (e) { /* fall through */ }
  }
  s = s.replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase();
  s = s.replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u');
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function tokens(text) { return fold(text).match(/[a-z0-9]+/g) || []; }

const DEFAULT_FAILURE_RE = /error|failed|not found|exception|traceback|cannot|denied|exit code [1-9]|non-zero/i;
const CORRECTION_PHRASES = ['olmadi', 'hala', 'yine', 'tekrar ayni', 'yanlis', 'bozuk', 'calismiyor', 'duzelmedi', 'yamuk', 'hata veriyor',
  "doesn't work", 'still', 'again', 'wrong', 'broken', 'not fixed', 'same error'];
const APPROVAL_PHRASES = ['oldu', 'tamam', 'calisti', 'super', 'harika', 'works', 'fixed', 'perfect', 'thanks'];
const REJECT_RE = /user (doesn't want|rejected|denied)|interrupted by user|permission to use .* has been denied/i;
const SHELL_TOOLS = ['Bash', 'PowerShell'];

function phraseMatcher(phrases) {
  const list = phrases.map((p) => tokens(p)).filter((t) => t.length);
  return (text) => {
    const tk = tokens(text);
    if (!tk.length) return false;
    const joined = ' ' + tk.join(' ') + ' ';
    return list.some((ph) => joined.includes(' ' + ph.join(' ') + ' '));
  };
}

function buildClassifier(config) {
  config = config || {};
  let failRe = DEFAULT_FAILURE_RE;
  if (config.failureRegex) { try { failRe = new RegExp(config.failureRegex, 'i'); } catch (e) { /* keep default */ } }
  const isCorrectionText = phraseMatcher(CORRECTION_PHRASES.concat(config.extraCorrectionWords || []));
  const isApprovalText = phraseMatcher(APPROVAL_PHRASES);
  return {
    isFailure(ev) {
      if (ev.kind !== 'tool_result') return false;
      const text = ev.text || '';
      if (REJECT_RE.test(text)) return false;
      if (ev.isError) return true;
      return SHELL_TOOLS.includes(ev.tool) && failRe.test(text);
    },
    isCorrection(ev) { return ev.kind === 'user' && (ev.text || '').length <= 400 && isCorrectionText(ev.text); },
    isApproval(ev) { return ev.kind === 'user' && (ev.text || '').length <= 300 && isApprovalText(ev.text); }
  };
}

function commandHead(cmd) {
  let c = String(cmd || '').trim();
  c = c.replace(/^(cd\s+("[^"]*"|'[^']*'|\S+)\s*(&&|;)\s*)+/i, '');
  const words = c.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.replace(/^["']|["']$/g, '').toLowerCase());
  return words.join(' ');
}

function targetOf(ev) {
  const inp = ev.input;
  if (!inp || typeof inp !== 'object') return null;
  const f = inp.file_path || inp.notebook_path || inp.path;
  if (f) return 'f:' + String(f).replace(/\\/g, '/').toLowerCase();
  if (inp.command) {
    const h = commandHead(inp.command);
    if (h) return 'c:' + h;
  }
  return null;
}

/**
 * Detect episodes in an event list. Returns array of
 * { id, firstIdx, lastIdx, failures, corrections, resolved, resolveIdx, score, targets, files, commands }.
 */
function detectEpisodes(session, config) {
  const cls = buildClassifier(config);
  const ev = session.events || [];
  const sid = session.sessionId || 'unknown';
  const eps = [];
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    let kind = null;
    if (cls.isFailure(e)) kind = 'fail';
    else if (cls.isCorrection(e)) kind = 'corr';
    if (!kind) continue;
    const tgt = kind === 'fail' ? targetOf(e) : null;
    let ep = null;
    for (let k = eps.length - 1; k >= 0; k--) {
      const c = eps[k];
      if (tgt && c.targets.has(tgt)) { ep = c; break; }
    }
    if (!ep) {
      for (let k = eps.length - 1; k >= 0; k--) {
        if (i - eps[k].lastIdx <= 10) { ep = eps[k]; break; }
      }
    }
    if (!ep) {
      ep = { firstIdx: i, lastIdx: i, failures: 0, corrections: 0, targets: new Set(), failIdx: [], corrIdx: [], firstId: e.id };
      eps.push(ep);
    }
    ep.lastIdx = i;
    if (kind === 'fail') { ep.failures++; ep.failIdx.push(i); if (tgt) ep.targets.add(tgt); } else { ep.corrections++; ep.corrIdx.push(i); }
  }
  const out = [];
  for (const ep of eps) {
    if (!(ep.failures >= 2 || ep.corrections >= 1)) continue;
    // resolution: later success on same target, or approval message
    let resolveIdx = -1;
    for (let i = ep.lastIdx + 1; i < ev.length && i <= ep.lastIdx + 60; i++) {
      const e = ev[i];
      if (e.kind === 'tool_result' && !cls.isFailure(e)) {
        const t = targetOf(e);
        if (t && ep.targets.has(t)) { resolveIdx = i; break; }
      }
      if (i <= ep.lastIdx + 30 && cls.isApproval(e)) { resolveIdx = i; break; }
    }
    const resolved = resolveIdx >= 0;
    const files = []; const commands = [];
    for (const i of ep.failIdx) {
      const inp = ev[i].input || {};
      const f = inp.file_path || inp.notebook_path || inp.path;
      if (f && !files.includes(f)) files.push(f);
      if (inp.command) { const c = String(inp.command).replace(/\s+/g, ' ').slice(0, 120); if (!commands.includes(c)) commands.push(c); }
    }
    const first = ev[ep.firstIdx];
    out.push({
      id: crypto.createHash('sha1').update(sid + String(first.id || ep.firstIdx)).digest('hex').slice(0, 12),
      firstIdx: ep.firstIdx, lastIdx: ep.lastIdx, failures: ep.failures, corrections: ep.corrections,
      resolved, resolveIdx, score: ep.failures + 3 * ep.corrections + (resolved ? 2 : 0),
      targets: Array.from(ep.targets), files: files.slice(0, 8), commands: commands.slice(0, 6)
    });
  }
  return out;
}

const oneLine = (s, n) => {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s;
};

function describeUse(e) {
  const i = e.input || {};
  if (i.command) return (e.tool || 'tool') + ': ' + i.command;
  const f = i.file_path || i.notebook_path || i.path;
  if (f) return (e.tool || 'tool') + ': ' + f;
  return (e.tool || 'tool') + (i.pattern ? ': ' + i.pattern : '');
}

/** Compact timeline (<= 6000 chars incl. header) for one episode. */
function renderDigest(session, ep, config) {
  const ev = session.events;
  const cls = buildClassifier(config);
  const fail = new Set(); // indices of failing results
  for (const i of ep.failIdx || []) fail.add(i);
  // recompute fail set (ep from detectEpisodes lacks failIdx)
  for (let i = ep.firstIdx; i <= ep.lastIdx; i++) if (cls.isFailure(ev[i])) fail.add(i);
  const end = Math.min(ev.length - 1, ep.resolved ? ep.resolveIdx + 3 : ep.lastIdx + 6);
  let askIdx = -1;
  for (let i = ep.firstIdx - 1; i >= 0 && i >= ep.firstIdx - 60; i--) {
    if (ev[i].kind === 'user' && !cls.isCorrection(ev[i])) { askIdx = i; break; }
  }
  const start = Math.max(askIdx >= 0 ? askIdx : ep.firstIdx, 0);
  const items = [];
  let pendingUse = null;
  for (let i = start; i <= end; i++) {
    const e = ev[i];
    if (e.kind === 'user') {
      const tag = i === askIdx ? 'USER ASKS' : cls.isCorrection(e) ? 'USER CORRECTS' : cls.isApproval(e) && ep.resolved && i === ep.resolveIdx ? 'USER APPROVES' : 'USER';
      items.push({ text: tag + ': ' + e.text, keep: tag !== 'USER' , cap: tag === 'USER ASKS' ? 500 : 400 });
    } else if (e.kind === 'assistant') {
      const nearFix = ep.resolved && i >= ep.lastIdx;
      items.push({ text: 'ASSISTANT: ' + e.text, keep: nearFix, cap: nearFix ? 700 : 300 });
    } else if (e.kind === 'tool_use') {
      pendingUse = e;
    } else if (e.kind === 'tool_result') {
      const isFail = fail.has(i);
      const use = e.tool ? e : pendingUse;
      const label = isFail ? 'FAILED ATTEMPT' : i === ep.resolveIdx ? 'RESOLVING STEP (ok)' : 'step (ok)';
      if (!isFail && label === 'step (ok)' && i < ep.lastIdx) continue; // skip successful noise inside the episode
      items.push({ text: label + ' ' + describeUse(use || e) + '\n    output: ' + e.text, keep: isFail || i === ep.resolveIdx, cap: isFail ? 300 : 300 });
    }
  }
  const head = [
    '# Candidate ' + ep.id,
    '',
    '- session: ' + (session.title || session.summary || session.sessionId || 'unknown'),
    '- project: ' + (session.project || 'unknown') + (session.cwd ? ' (' + session.cwd + ')' : ''),
    '- dates: ' + (session.start || '?') + ' .. ' + (session.end || '?'),
    '- score: ' + ep.score + ' (failures ' + ep.failures + ', corrections ' + ep.corrections + ', resolved ' + (ep.resolved ? 'yes' : 'no') + ')',
    '- files: ' + (ep.files.join(', ') || '-'),
    '- commands: ' + (ep.commands.join(' | ') || '-'),
    '',
    '## Timeline',
    ''
  ].join('\n');
  const budget = 6000 - head.length - 2;
  const pick = (list, max) => {
    if (list.length <= max) return list;
    const h = Math.ceil(max / 2);
    return list.slice(0, h).concat(list.slice(list.length - (max - h)));
  };
  const chosen = new Set(pick(items.filter((i) => i.keep), 20).concat(pick(items.filter((i) => !i.keep), 14)));
  let sel = items.filter((i) => chosen.has(i));
  const render = (list, caps) => list.map((it) => '- ' + oneLine(it.text.replace(/\n    output: /, ' || output: '), Math.min(it.cap, caps))).join('\n');
  let body = '';
  for (;;) {
    for (const caps of [1000, 300, 200, 120, 70]) {
      body = render(sel, caps);
      if (body.length <= budget) break;
    }
    if (body.length <= budget || sel.length <= 3) break;
    sel = pick(sel, Math.max(3, Math.floor(sel.length * 0.7)));
  }
  if (body.length > budget) body = body.slice(0, budget - 1) + '…';
  return head + body + '\n';
}

function parseSince(s) {
  if (!s) return 0;
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error('invalid --since date: ' + s);
  return t;
}

/** Sessions to scan: archive entries plus live transcripts that are not (or no longer) archived. */
function collectSessions(opts) {
  const p = resolvePaths(opts.home);
  const idx = loadIndex(opts.home);
  const byId = new Map();
  for (const [sid, e] of Object.entries(idx.sessions || {})) {
    const f = path.join(p.archive, e.file || '');
    if (!e.file || !fs.existsSync(f)) continue;
    byId.set(sid, { sessionId: sid, kind: 'archive', file: f, slug: String(e.file).split('/')[0], size: e.size, mtimeMs: e.mtimeMs, cwd: e.cwd });
  }
  const roots = transcriptRoots(opts.home, opts.roots);
  for (const t of listTranscripts(roots)) {
    const a = byId.get(t.sessionId);
    if (a && a.kind === 'archive' && a.size === t.size && a.mtimeMs === t.mtimeMs) continue;
    byId.set(t.sessionId, { sessionId: t.sessionId, kind: 'live', file: t.file, slug: t.slug, size: t.size, mtimeMs: t.mtimeMs });
  }
  let list = Array.from(byId.values());
  const since = parseSince(opts.since);
  if (since) list = list.filter((s) => s.mtimeMs >= since);
  if (opts.project) {
    const q = fold(opts.project);
    list = list.filter((s) => fold(s.slug + ' ' + (s.cwd || '')).includes(q));
  }
  return list;
}

/**
 * Scan sessions, write candidates/<id>.md, update candidates/index.json. Idempotent.
 * Returns { sessions, scanned, found, written, skippedRejected, candidates }.
 */
async function harvest(opts) {
  opts = opts || {};
  const p = resolvePaths(opts.home);
  const config = loadConfig(opts.home);
  const limit = opts.limit > 0 ? opts.limit : 200;
  const idxFile = path.join(p.candidates, 'index.json');
  const index0 = readJson(idxFile, null) || { version: 1, scanned: {}, candidates: {} };
  const scannedPrev = index0.scanned || {};
  const sessions = collectSessions(opts);
  const stats = { sessions: sessions.length, scanned: 0, found: 0, written: 0, skippedRejected: 0, failed: 0 };
  const found = [];
  const scannedNow = {};
  for (const s of sessions) {
    const sig = s.kind + ':' + s.size + ':' + s.mtimeMs;
    if (!opts.rescan && scannedPrev[s.sessionId] === sig) continue;
    let t;
    try {
      t = s.kind === 'archive' ? await readArchived(s.file, { slug: s.slug, sessionId: s.sessionId }) : await readTranscript(s.file);
    } catch (e) { stats.failed++; continue; }
    stats.scanned++;
    scannedNow[s.sessionId] = sig;
    if (!t.sessionId) t.sessionId = s.sessionId;
    for (const ep of detectEpisodes(t, config)) {
      found.push({ ep, digest: renderDigest(t, ep, config), session: t });
    }
  }
  stats.found = found.length;
  found.sort((a, b) => b.ep.score - a.ep.score);
  const top = found.slice(0, limit);
  fs.mkdirSync(p.candidates, { recursive: true });
  const written = [];
  await updateJson(idxFile, { version: 1, scanned: {}, candidates: {} }, (idx) => {
    if (!idx.candidates) idx.candidates = {};
    if (!idx.scanned) idx.scanned = {};
    Object.assign(idx.scanned, scannedNow);
    for (const { ep, digest, session } of top) {
      const cur = idx.candidates[ep.id];
      if (cur && cur.status === 'rejected') { stats.skippedRejected++; continue; }
      const file = path.join(p.candidates, ep.id + '.md');
      if (!cur || cur.status === 'new' || !fs.existsSync(file)) writeAtomic(file, digest);
      idx.candidates[ep.id] = Object.assign({}, cur || {}, {
        status: cur ? cur.status : 'new', session: session.sessionId, title: session.title || session.summary || null,
        project: session.project || null, score: ep.score, resolved: ep.resolved, failures: ep.failures, corrections: ep.corrections,
        created: (cur && cur.created) || new Date().toISOString()
      });
      written.push(ep.id);
    }
    return idx;
  });
  stats.written = written.length;
  stats.candidates = written;
  return stats;
}

function listCandidates(home) {
  const idx = readJson(path.join(resolvePaths(home).candidates, 'index.json'), null) || { candidates: {} };
  return Object.entries(idx.candidates || {}).map(([id, c]) => Object.assign({ id }, c)).sort((a, b) => (b.score || 0) - (a.score || 0));
}

async function setCandidateStatus(home, id, patch) {
  const idxFile = path.join(resolvePaths(home).candidates, 'index.json');
  let ok = false;
  await updateJson(idxFile, { version: 1, scanned: {}, candidates: {} }, (idx) => {
    if (idx.candidates && idx.candidates[id]) { Object.assign(idx.candidates[id], patch); ok = true; }
    return idx;
  });
  return ok;
}

module.exports = { harvest, detectEpisodes, renderDigest, collectSessions, listCandidates, setCandidateStatus, buildClassifier, targetOf, tokens };
