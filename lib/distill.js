'use strict';
// Turn a harvested candidate into a draft lesson through the user's own `claude` CLI.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { resolvePaths, loadConfig, writeAtomic } = require('./archive');
const { listCandidates, setCandidateStatus } = require('./harvest');

const TIMEOUT_MS = 120000;

const PROMPT_HEADER = `You are curating a personal knowledge base of engineering lessons for a developer who works with an AI coding agent across many projects. Below is a digest of one troubleshooting episode taken from a past session: failed attempts, user corrections, and (if present) the step that finally worked.

Decide whether the episode contains ONE reusable lesson, and if so write it.

A good lesson:
- is GENERALIZABLE: it would help on a different project that hits the same class of problem (a tool quirk, an engine/API pitfall, a wrong assumption, a platform gotcha, a repeated misunderstanding of what the user wants).
- states what did not work, the real root cause, and the fix that worked, concretely enough to act on.
- contains no secrets, no personal names, no machine-specific absolute paths; describe things generically.

Return {"lesson": null} when the episode is only: a one-off typo, project-specific trivia, a normal edit/test cycle, a flaky network, a user preference that is not about avoiding a technical mistake, or when the digest does not show what the root cause or fix was.

Output rules (strict):
- Reply with ONE JSON object and nothing else: no prose, no code fences.
- Shape: {"lesson": null} or
  {"lesson": {"id": "kebab-case-slug", "title": "one line, <= 90 chars", "keywords": [..], "strong": [..], "engines": [..], "paths": [..], "errors": [..], "body": "..."}}
- keywords: 6 to 12 SINGLE WORDS or word stems (at most 2 words only for fixed terms like "class_name" or "app store"), lowercase. Matching is: a keyword of 4+ letters matches any word that starts with it, so prefer stems that cover inflections (e.g. "calisma" for calismiyor/calismadi, "kayb" is too short, use "kaybol"); the lesson fires when 2 distinct keywords appear in the user's message. Long phrases almost never match: do not write them. Include words someone would type when starting such a task or describing the symptom, BOTH in the language of the conversation in the digest AND in English. Avoid generic words alone (error, hata, test, file, dosya, yeni, kod, oyun, fix).
- strong: 0 to 2 distinctive single terms (a tool name, an API name, an error code) that alone justify showing the lesson; never a generic word; leave empty if unsure.
- the body should be written in the language of the conversation in the digest; the bold labels stay as given.
- engines: subset of godot, unity, unreal, electron, expo, react-native, node, python, rust, dotnet, web; empty if the lesson is engine-independent.
- paths: file globs that signal the lesson (e.g. "**/*.gdshader"); usually empty.
- errors: 0 to 4 literal substrings of error messages that identify the problem; usually empty.
- body: Markdown with exactly these three bold labels, one short paragraph each, under 700 characters total:
  **Didn't work:** ...
  **Root cause:** ...
  **Fix:** ...

EPISODE DIGEST
--------------
`;

function buildPrompt(digest) {
  return PROMPT_HEADER + digest.trim() + '\n--------------\nNow reply with the JSON object only.\n';
}

/** First balanced top-level JSON object in text (string-aware), parsed; null if none. */
function extractJsonObject(text) {
  if (typeof text !== 'string') return null;
  const s = text.replace(/```(?:json)?/gi, ' ');
  for (let start = s.indexOf('{'); start >= 0; start = s.indexOf('{', start + 1)) {
    let depth = 0; let inStr = false; let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { break; }
        }
      }
    }
  }
  return null;
}

function findOnPath(name) {
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : null;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try { if (fs.statSync(p).isFile()) return p; } catch (_) { /* not here */ }
  }
  return null;
}

function runClaude(prompt, opts) {
  opts = opts || {};
  const bin = opts.bin || 'claude';
  const args = ['-p', '--model', opts.model || 'haiku', '--output-format', 'json', '--max-turns', '1',
    '--no-session-persistence', '--strict-mcp-config'];
  let cmd = bin; let argv = args; let shell = false;
  if (/\.(c|m)?js$/i.test(bin)) { cmd = process.execPath; argv = [bin].concat(args); }
  else if (process.platform === 'win32' && !/\.(exe|com)$/i.test(bin)) {
    // Prefer a real .exe on PATH (no shell, no argument concatenation); fall back to the shell
    // for .cmd/.bat shims such as an npm-installed CLI.
    const exe = findOnPath(bin + '.exe');
    if (exe) cmd = exe; else shell = true;
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, argv, {
        cwd: os.tmpdir(), shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { MLP_DISABLE: '1' }) // our own hooks must not run inside the distill session
      });
    } catch (e) { reject(e); return; }
    let out = ''; let err = ''; let done = false;
    const timer = setTimeout(() => { finish(new Error('claude timed out after ' + Math.round((opts.timeoutMs || TIMEOUT_MS) / 1000) + 's'), true); }, opts.timeoutMs || TIMEOUT_MS);
    function finish(e, kill) {
      if (done) return;
      done = true; clearTimeout(timer);
      if (kill) { try { child.kill(); } catch (x) { /* ignore */ } }
      if (e) reject(e); else resolve(out);
    }
    child.stdout.on('data', (d) => { out += d; if (out.length > 4e6) finish(new Error('claude output too large'), true); });
    child.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    child.on('error', (e) => finish(e));
    child.on('close', (code) => {
      if (code !== 0 && !out.trim()) finish(new Error('claude exited with code ' + code + (err ? ': ' + err.trim().slice(0, 300) : '')));
      else finish(null);
    });
    child.stdin.on('error', () => { /* child exited early */ });
    child.stdin.end(prompt);
  });
}

/** Parse the CLI envelope + model reply. Returns { lesson: null|object }. Throws on garbage. */
function parseReply(stdout) {
  let result = stdout;
  const env = extractJsonObject(stdout);
  if (env && typeof env === 'object' && 'result' in env) {
    if (env.is_error) throw new Error('claude reported an error: ' + String(env.result).slice(0, 200));
    result = typeof env.result === 'string' ? env.result : JSON.stringify(env.result);
  } else if (env && 'lesson' in env) {
    return normalizeReply(env);
  }
  const obj = extractJsonObject(result);
  if (!obj || !('lesson' in obj)) throw new Error('model reply has no JSON object with a "lesson" key');
  return normalizeReply(obj);
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}
const strList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).replace(/[\r\n,]+/g, ' ').trim()).filter(Boolean);

function normalizeReply(obj) {
  const l = obj.lesson;
  if (l == null) return { lesson: null };
  if (typeof l !== 'object') throw new Error('"lesson" is neither null nor an object');
  const title = String(l.title || '').replace(/\s+/g, ' ').trim();
  const body = String(l.body || '').trim();
  if (!title || !body) return { lesson: null, invalid: true };
  const id = slugify(l.id) || slugify(title) || 'lesson';
  return { lesson: { id, title, keywords: strList(l.keywords), strong: strList(l.strong), engines: strList(l.engines).map((x) => x.toLowerCase()), paths: strList(l.paths), errors: strList(l.errors), body } };
}

function serializeDraft(lesson, candidateId, today) {
  const L = ['---', 'id: ' + lesson.id, 'title: ' + lesson.title, 'keywords: ' + lesson.keywords.join(', ')];
  L.push('strong: ' + lesson.strong.join(', '));
  L.push('engines: ' + lesson.engines.join(', '));
  L.push('paths: ' + lesson.paths.join(', '));
  L.push('errors: ' + lesson.errors.join(', '));
  L.push('created: ' + today, 'verified: ' + today, 'source: candidate ' + candidateId, 'status: draft', '---', lesson.body, '');
  return L.join('\n');
}

const RESERVED = new Set();
function existingLessonIds(p) {
  const ids = new Set(RESERVED);
  for (const dir of [p.lessons, p.drafts]) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch (e) { continue; }
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      ids.add(f.slice(0, -3));
      try {
        const m = /^id:\s*(.+)$/m.exec(fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 1500));
        if (m) ids.add(m[1].trim());
      } catch (e) { /* ignore */ }
    }
  }
  return ids;
}

/**
 * Distill one candidate. opts: { home, model, dryRun }.
 * Returns { id, status: 'draft'|'trivial'|'dry-run', prompt?, draft?, lessonId? }.
 */
async function distillCandidate(id, opts) {
  opts = opts || {};
  const p = resolvePaths(opts.home);
  const config = loadConfig(opts.home);
  const file = path.join(p.candidates, id + '.md');
  if (!fs.existsSync(file)) throw new Error('no such candidate: ' + id);
  const prompt = buildPrompt(fs.readFileSync(file, 'utf8'));
  if (opts.dryRun) return { id, status: 'dry-run', prompt };
  const model = opts.model || config.distillModel || 'haiku';
  const stdout = await runClaude(prompt, { bin: config.claudeBin || 'claude', model, timeoutMs: opts.timeoutMs });
  const reply = parseReply(stdout);
  if (!reply.lesson) {
    await setCandidateStatus(opts.home, id, { status: 'distilled', draft: null, trivial: true, distilledAt: new Date().toISOString() });
    return { id, status: 'trivial' };
  }
  const lesson = reply.lesson;
  const taken = existingLessonIds(p);
  const base = lesson.id; let n = 2;
  while (taken.has(lesson.id)) lesson.id = base + '-' + n++;
  RESERVED.add(lesson.id);
  const today = new Date().toISOString().slice(0, 10);
  const draftFile = path.join(p.drafts, id + '.md');
  writeAtomic(draftFile, serializeDraft(lesson, id, today));
  RESERVED.delete(lesson.id);
  await setCandidateStatus(opts.home, id, { status: 'distilled', draft: id, lessonId: lesson.id, trivial: false, distilledAt: new Date().toISOString() });
  return { id, status: 'draft', draft: draftFile, lessonId: lesson.id };
}

/** Distill many candidates with bounded concurrency. onResult(id, result|Error). */
async function distillMany(ids, opts, onResult) {
  const queue = ids.slice();
  const conc = Math.max(1, (opts && opts.concurrency) || 3);
  const results = [];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      let r;
      try { r = await distillCandidate(id, opts); } catch (e) { r = { id, status: 'error', error: e.message }; }
      results.push(r);
      if (onResult) onResult(id, r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, queue.length) }, worker));
  return results;
}

function pendingCandidateIds(home, limit) {
  const ids = listCandidates(home).filter((c) => c.status === 'new').map((c) => c.id);
  return limit > 0 ? ids.slice(0, limit) : ids;
}

module.exports = { distillCandidate, distillMany, pendingCandidateIds, buildPrompt, extractJsonObject, parseReply, runClaude, serializeDraft };
