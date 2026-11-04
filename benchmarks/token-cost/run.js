#!/usr/bin/env node
'use strict';
// A/B benchmark: does multi-lesson-path save tokens/cost?
//   off = hooks installed but disabled (MLP_DISABLE=1)
//   on  = hooks enabled, lessons store holds every task's lesson plus the generic examples
// See README.md in this folder. Zero dependencies.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const TASKS_DIR = path.join(HERE, 'tasks');
const MLP_BIN = path.join(REPO, 'bin', 'mlp.js');
const EXAMPLES_DIR = path.join(REPO, 'examples', 'lessons');
const TIMEOUT_MS = 10 * 60 * 1000;
// Fixed time zone so the timestamp task is not accidentally solved by the machine's own zone.
const BENCH_TZ = 'America/Los_Angeles';

const ALLOWED_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(node:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(rm:*)', 'Bash(cd:*)'];

function parseArgs(argv) {
  const o = {
    model: 'haiku', reps: 3, tasks: null, conditions: ['off', 'on'], maxTurns: 30, budget: 0.6,
    out: null, dryRun: false, claude: 'claude', keep: false,
  };
  const need = (i, name) => {
    if (i + 1 >= argv.length) throw new Error('missing value for ' + name);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') o.model = need(i++, a);
    else if (a === '--reps') o.reps = parseInt(need(i++, a), 10);
    else if (a === '--tasks') o.tasks = need(i++, a).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--conditions') o.conditions = need(i++, a).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--max-turns') o.maxTurns = parseInt(need(i++, a), 10);
    else if (a === '--budget') o.budget = parseFloat(need(i++, a));
    else if (a === '--out') o.out = need(i++, a);
    else if (a === '--claude') o.claude = need(i++, a);
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--keep') o.keep = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  if (!(o.reps >= 1)) throw new Error('--reps must be >= 1');
  if (!(o.maxTurns >= 1)) throw new Error('--max-turns must be >= 1');
  if (!(o.budget > 0)) throw new Error('--budget must be > 0');
  for (const c of o.conditions) if (c !== 'off' && c !== 'on') throw new Error('unknown condition: ' + c);
  return o;
}

const USAGE = `usage: node benchmarks/token-cost/run.js [options]
  --model <m>          model alias (default haiku)
  --reps <n>           repetitions per task and condition (default 3)
  --tasks a,b          task names (default all)
  --conditions off,on  conditions (default off,on)
  --max-turns <n>      default 30
  --budget <usd>       per-run --max-budget-usd, default 0.60
  --out <file>         results JSONL (default results/<date>.jsonl)
  --claude <bin>       claude binary, or a .js fake (default: claude from PATH)
  --dry-run            set everything up, validate the tasks, spawn nothing
  --keep               keep the temp folders of each run`;

function listTasks() {
  return fs.readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(TASKS_DIR, d.name, 'task.txt')))
    .map((d) => d.name).sort();
}

function taskPaths(name) {
  const dir = path.join(TASKS_DIR, name);
  return {
    dir,
    project: path.join(dir, 'project'),
    prompt: path.join(dir, 'task.txt'),
    verify: path.join(dir, 'verify.js'),
    solution: path.join(dir, 'solution.js'),
    lesson: path.join(dir, 'lesson.md'),
  };
}

function resolveClaude(bin) {
  if (/\.(c|m)?js$/i.test(bin)) return { cmd: process.execPath, pre: [path.resolve(bin)] };
  if (/[\\/]/.test(bin) && fs.existsSync(bin)) return { cmd: path.resolve(bin), pre: [] };
  const win = process.platform === 'win32';
  const names = win ? [bin.replace(/\.exe$/i, '') + '.exe'] : [bin];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const n of names) {
      const p = path.join(dir, n);
      try { if (fs.statSync(p).isFile()) return { cmd: p, pre: [] }; } catch (e) { /* keep looking */ }
    }
  }
  if (win) throw new Error('claude.exe not found on PATH; pass --claude <path to claude.exe>');
  throw new Error('"' + bin + '" not found on PATH; pass --claude <path>');
}

function hookCommand(kind) {
  return 'node "' + MLP_BIN.replace(/\\/g, '/') + '" hook ' + kind;
}

// Settings with ONLY our hooks, so the user's personal hooks never take part.
function buildSettings() {
  const entry = (kind, matcher) => {
    const e = {};
    if (matcher) e.matcher = matcher;
    e.hooks = [{ type: 'command', command: hookCommand(kind), timeout: 5 }];
    return [e];
  };
  return {
    hooks: {
      UserPromptSubmit: entry('prompt'),
      PreToolUse: entry('edit', 'Edit|Write|MultiEdit|NotebookEdit'),
      PostToolUse: entry('post-tool', 'Bash'),
      SessionStart: entry('session-start'),
    },
  };
}

function claudeArgs(opts, settingsFile) {
  return [
    '-p', '--model', opts.model, '--output-format', 'json',
    '--max-turns', String(opts.maxTurns), '--max-budget-usd', String(opts.budget),
    '--no-session-persistence', '--strict-mcp-config',
    '--setting-sources', 'project', '--settings', settingsFile,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ...ALLOWED_TOOLS,
  ];
}

function allTaskLessons(taskNames) {
  const out = [];
  for (const n of taskNames) {
    const p = taskPaths(n).lesson;
    if (fs.existsSync(p)) out.push({ task: n, file: p });
  }
  return out;
}

// Fresh project copy + fresh MLP_HOME + settings file, all under one temp root.
function prepareRun(taskName, lessonSources) {
  // realpath: on Windows os.tmpdir() can be an 8.3 short path (a "~1" folder name). Claude Code
  // resolves files to their long path, sees them as outside the working directory and denies
  // the edits in non-interactive mode, so every run would fail for reasons unrelated to lessons.
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mlp-bench-')));
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  fs.cpSync(taskPaths(taskName).project, project, { recursive: true });
  fs.mkdirSync(path.join(home, 'lessons'), { recursive: true });
  for (const f of fs.readdirSync(EXAMPLES_DIR)) {
    if (f.endsWith('.md')) fs.copyFileSync(path.join(EXAMPLES_DIR, f), path.join(home, 'lessons', f));
  }
  for (const l of lessonSources) fs.copyFileSync(l.file, path.join(home, 'lessons', 'bench-' + l.task + '.md'));
  const settingsFile = path.join(root, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify(buildSettings(), null, 2));
  return { root, project, home, settingsFile };
}

function runEnv(condition, home) {
  const env = Object.assign({}, process.env, { MLP_HOME: home, TZ: BENCH_TZ });
  delete env.MLP_DISABLE;
  if (condition === 'off') env.MLP_DISABLE = '1';
  return env;
}

function spawnClaude(claude, args, opts) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(claude.cmd, claude.pre.concat(args), {
        cwd: opts.cwd, env: opts.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ code: null, stdout, stderr: String(e.message || e), timedOut });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch (e) { /* already gone */ }
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { stderr += String(e.message || e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => { /* child may exit before reading */ });
    child.stdin.end(opts.input);
  });
}

// The CLI prints one JSON object; some versions print an array of events. Accept both.
function parseEnvelope(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  let v;
  try { v = JSON.parse(text); } catch (e) {
    const line = text.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'));
    if (!line) return null;
    try { v = JSON.parse(line); } catch (e2) { return null; }
  }
  if (Array.isArray(v)) v = v.slice().reverse().find((x) => x && x.type === 'result') || null;
  return v && typeof v === 'object' ? v : null;
}

function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

function readHits(home) {
  const f = path.join(home, 'hits.jsonl');
  let ids = [];
  try {
    ids = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
      try { return JSON.parse(l).lesson; } catch (e) { return null; }
    }).filter(Boolean);
  } catch (e) { /* no hits */ }
  return ids;
}

function runNode(script, cwd, env) {
  return spawnSync(process.execPath, [script], { cwd, env: env || process.env, encoding: 'utf8', timeout: 60000, windowsHide: true });
}

async function executeRun(task, condition, rep, opts, claude, lessons) {
  const prep = prepareRun(task, lessons);
  const tp = taskPaths(task);
  const prompt = fs.readFileSync(tp.prompt, 'utf8').trim() + '\n';
  const env = runEnv(condition, prep.home);
  const res = await spawnClaude(claude, claudeArgs(opts, prep.settingsFile), { cwd: prep.project, env, input: prompt });
  const env_ = parseEnvelope(res.stdout);
  const v = runNode(tp.verify, prep.project, env);
  const hits = readHits(prep.home);
  const u = (env_ && env_.usage) || {};
  const input = num(u.input_tokens);
  const output = num(u.output_tokens);
  const cacheRead = num(u.cache_read_input_tokens);
  const cacheCreate = num(u.cache_creation_input_tokens);
  let error = null;
  if (res.timedOut) error = 'timeout';
  else if (!env_) error = 'no JSON envelope (exit ' + res.code + '): ' + String(res.stderr || res.stdout).trim().slice(0, 200);
  else if (env_.is_error) error = String(env_.subtype || 'error');
  else if (env_.subtype && env_.subtype !== 'success') error = String(env_.subtype);
  const record = {
    task, condition, rep, model: opts.model,
    success: v.status === 0,
    cost_usd: num(env_ && env_.total_cost_usd),
    input_tokens: input, output_tokens: output,
    cache_read_tokens: cacheRead, cache_creation_tokens: cacheCreate,
    total_tokens: input + output + cacheRead + cacheCreate,
    turns: num(env_ && env_.num_turns),
    duration_ms: num(env_ && env_.duration_ms),
    injected: hits.length,
    injected_lessons: Array.from(new Set(hits)),
    error,
  };
  if (opts.keep) record.kept_dir = prep.root;
  else { try { fs.rmSync(prep.root, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
  return record;
}

// Dry run: show what would be spawned and prove the tasks are neither pre-solved nor unsolvable.
function dryRun(opts, taskNames, lessons) {
  let bad = 0;
  let shownCmd = false;
  for (const task of taskNames) {
    const tp = taskPaths(task);
    const a = prepareRun(task, lessons);
    const untouched = runNode(tp.verify, a.project);
    const b = prepareRun(task, lessons);
    const sol = runNode(tp.solution, b.project);
    const solved = sol.status === 0 ? runNode(tp.verify, b.project) : { status: 1 };
    const okA = untouched.status !== 0;
    const okB = solved.status === 0;
    if (!okA || !okB) bad++;
    const nLessons = fs.readdirSync(path.join(a.home, 'lessons')).length;
    console.log(task.padEnd(20) + ' untouched: ' + (okA ? 'verify FAILS (good)' : 'verify PASSES (task is pre-solved!)') +
      ' | with intended fix: ' + (okB ? 'verify passes (good)' : 'verify FAILS (task is unsolvable!)') +
      ' | lessons in store: ' + nLessons);
    if (!shownCmd) {
      shownCmd = true;
      console.log('\nsettings file (hooks only):\n' + fs.readFileSync(a.settingsFile, 'utf8'));
      console.log('\ncommand per run (cwd = temp project, prompt on stdin, env MLP_HOME=<temp>, TZ=' + BENCH_TZ + ', MLP_DISABLE=1 for off):\n  ' +
        [opts.claude].concat(claudeArgs(opts, '<settings.json>')).map((x) => (/[\s()*|]/.test(x) ? '"' + x + '"' : x)).join(' ') + '\n');
    }
    for (const d of [a.root, b.root]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
  }
  const runs = taskNames.length * opts.conditions.length * opts.reps;
  console.log('\n' + runs + ' runs planned (' + taskNames.length + ' tasks x ' + opts.conditions.join('/') + ' x ' + opts.reps + ' reps), model ' +
    opts.model + ', budget cap up to $' + (runs * opts.budget).toFixed(2) + ' in total.');
  return bad === 0;
}

function defaultOut() {
  const d = new Date().toISOString().slice(0, 10);
  return path.join(HERE, 'results', d + '.jsonl');
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message + '\n' + USAGE); return 2; }
  if (opts.help) { console.log(USAGE); return 0; }
  const all = listTasks();
  const taskNames = opts.tasks || all;
  for (const t of taskNames) if (!all.includes(t)) { console.error('unknown task: ' + t + ' (have: ' + all.join(', ') + ')'); return 2; }
  const lessons = allTaskLessons(all);

  if (opts.dryRun) return dryRun(opts, taskNames, lessons) ? 0 : 1;

  let claude;
  try { claude = resolveClaude(opts.claude); } catch (e) { console.error(e.message); return 2; }
  const out = path.resolve(opts.out || defaultOut());
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const plan = [];
  for (let rep = 1; rep <= opts.reps; rep++) {
    for (const task of taskNames) for (const condition of opts.conditions) plan.push({ task, condition, rep });
  }
  console.log('results -> ' + out + ' (' + plan.length + ' runs)');
  let n = 0;
  for (const p of plan) {
    n++;
    const t0 = Date.now();
    const r = await executeRun(p.task, p.condition, p.rep, opts, claude, lessons);
    fs.appendFileSync(out, JSON.stringify(r) + '\n');
    console.log('[' + n + '/' + plan.length + '] ' + p.task + ' ' + p.condition + ' rep' + p.rep + ': ' + (r.success ? 'solved' : 'NOT solved') +
      ', $' + r.cost_usd.toFixed(4) + ', ' + r.turns + ' turns, ' + r.total_tokens + ' tokens, injected ' + r.injected +
      ', ' + Math.round((Date.now() - t0) / 1000) + 's' + (r.error ? ', error: ' + r.error : ''));
  }
  console.log('done. Next: node benchmarks/token-cost/report.js ' + out);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e && e.stack || e); process.exitCode = 1; });
