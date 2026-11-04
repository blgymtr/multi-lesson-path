'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FIXTURES, makeHome, tmpDir, rmDir, runCli } = require('./helpers');
const settings = require('../lib/settings');

function setup() {
  const home = makeHome();
  const dir = tmpDir('settings');
  const file = path.join(dir, 'settings.json');
  fs.copyFileSync(path.join(FIXTURES, 'settings.json'), file);
  return { home, dir, file, done() { rmDir(home); rmDir(dir); } };
}

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const ours = (s) => JSON.stringify(s).includes('multi-lesson-path') || /mlp\.js/.test(JSON.stringify(s));

test('install merges hooks, preserves other tools, backs up, copies app', () => {
  const t = setup();
  try {
    const before = read(t.file);
    const r = runCli(['install', '--settings', t.file], { home: t.home });
    assert.equal(r.code, 0, r.stderr);
    const after = read(t.file);

    // unrelated content intact
    assert.equal(after.model, 'opus');
    assert.deepEqual(after.permissions, before.permissions);
    assert.deepEqual(after.hooks.Stop, before.hooks.Stop);
    assert.deepEqual(after.hooks.PreCompact, before.hooks.PreCompact);
    assert.deepEqual(after.hooks.SessionStart[0], before.hooks.SessionStart[0]);
    assert.deepEqual(after.hooks.SessionEnd[0], before.hooks.SessionEnd[0]);

    // our five hooks
    assert.equal(after.hooks.SessionStart.length, 2);
    assert.equal(after.hooks.SessionEnd.length, 2);
    assert.equal(after.hooks.UserPromptSubmit[0].hooks[0].timeout, 5);
    assert.equal(after.hooks.SessionEnd[1].hooks[0].timeout, 10);
    assert.equal(after.hooks.PreToolUse[0].matcher, 'Edit|Write|MultiEdit|NotebookEdit');
    assert.equal(after.hooks.PostToolUse[0].matcher, 'Bash|PowerShell');
    const cmd = after.hooks.UserPromptSubmit[0].hooks[0].command;
    assert.match(cmd, /^node "[^"\\]+\/app\/bin\/mlp\.js" hook prompt$/);
    assert.ok(cmd.includes(t.home.replace(/\\/g, '/')));
    assert.deepEqual(Object.keys(settings.findInstalled(after)).sort(), ['edit', 'post-tool', 'prompt', 'session-end', 'session-start']);

    // backup, app copy, dirs
    const backups = fs.readdirSync(t.dir).filter((f) => f.includes('.bak-mlp-'));
    assert.equal(backups.length, 1);
    assert.deepEqual(read(path.join(t.dir, backups[0])), before);
    for (const f of ['bin/mlp.js', 'lib/hooks.js', 'lib/commands/install.js', 'package.json']) {
      assert.ok(fs.existsSync(path.join(t.home, 'app', f)), f);
    }
    for (const d of ['lessons', 'drafts', 'candidates', 'archive', 'state']) assert.ok(fs.existsSync(path.join(t.home, d)), d);
    assert.equal(fs.readFileSync(t.file, 'utf8').split('\n')[1].startsWith('  "'), true); // 2-space indent
  } finally { t.done(); }
});

test('installed copy runs its hooks against its own home', () => {
  const t = setup();
  try {
    assert.equal(runCli(['install', '--settings', t.file], { home: t.home }).code, 0);
    const cmd = read(t.file).hooks.UserPromptSubmit[0].hooks[0].command;
    const script = /node "([^"]+)"/.exec(cmd)[1];
    const { spawnSync } = require('child_process');
    const env = Object.assign({}, process.env);
    delete env.MLP_HOME;
    const r = spawnSync(process.execPath, [script, 'hook', 'prompt'], {
      input: JSON.stringify({ prompt: 'viewmodel wrist', cwd: t.dir, session_id: 'inst' }), encoding: 'utf8', env,
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /fps-viewmodel-hands/);
  } finally { t.done(); }
});

test('install is idempotent (no duplicates, no rewrite, no extra backup)', () => {
  const t = setup();
  try {
    runCli(['install', '--settings', t.file], { home: t.home });
    const once = fs.readFileSync(t.file, 'utf8');
    const r = runCli(['install', '--settings', t.file], { home: t.home });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fs.readFileSync(t.file, 'utf8'), once);
    assert.equal(fs.readdirSync(t.dir).filter((f) => f.includes('.bak-mlp-')).length, 1);
  } finally { t.done(); }
});

test('re-install replaces an old entry of ours in place', () => {
  const t = setup();
  try {
    const s = read(t.file);
    s.hooks.UserPromptSubmit = [
      { hooks: [{ type: 'command', command: 'node "/old/multi-lesson-path/app/bin/mlp.js" hook prompt', timeout: 1 }] },
      { hooks: [{ type: 'command', command: 'node "/opt/other-tool/prompt.js"' }] },
    ];
    fs.writeFileSync(t.file, JSON.stringify(s));
    assert.equal(runCli(['install', '--settings', t.file], { home: t.home }).code, 0);
    const after = read(t.file);
    assert.equal(after.hooks.UserPromptSubmit.length, 2);
    assert.match(after.hooks.UserPromptSubmit[0].hooks[0].command, new RegExp(t.home.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]]/g, '\\$&')));
    assert.equal(after.hooks.UserPromptSubmit[1].hooks[0].command, 'node "/opt/other-tool/prompt.js"');
  } finally { t.done(); }
});

test('install on a missing settings file creates it; broken JSON is left alone', () => {
  const t = setup();
  try {
    const fresh = path.join(t.dir, 'sub', 'new.json');
    assert.equal(runCli(['install', '--settings', fresh], { home: t.home }).code, 0);
    assert.ok(ours(read(fresh)));
    const broken = path.join(t.dir, 'broken.json');
    fs.writeFileSync(broken, '{ not json');
    const r = runCli(['install', '--settings', broken], { home: t.home });
    assert.equal(r.code, 1);
    assert.equal(fs.readFileSync(broken, 'utf8'), '{ not json');
  } finally { t.done(); }
});

test('uninstall removes only our entries and keeps data', () => {
  const t = setup();
  try {
    const original = read(t.file);
    runCli(['install', '--settings', t.file], { home: t.home });
    const r = runCli(['uninstall', '--settings', t.file], { home: t.home });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(read(t.file), original);
    assert.ok(fs.existsSync(path.join(t.home, 'lessons', 'fps-viewmodel-hands.md')));
    const again = runCli(['uninstall', '--settings', t.file], { home: t.home });
    assert.match(again.stdout, /nothing to remove/);
  } finally { t.done(); }
});

test('settings.mergeUninstall drops empty events and empty hooks object', () => {
  const merged = settings.mergeInstall({}, '/x/multi-lesson-path/app');
  assert.equal(Object.keys(merged.hooks).length, 5);
  assert.deepEqual(settings.mergeUninstall(merged), {});
});

test('--home flag overrides MLP_HOME; help lists commands; unknown command exits 1', () => {
  const home = makeHome();
  const other = tmpDir('other');
  try {
    const r = runCli(['--home', home, 'list'], { home: other });
    assert.match(r.stdout, /fps-viewmodel-hands/);
    const h = runCli(['help'], { home });
    assert.equal(h.code, 0);
    for (const c of ['install', 'check', 'hook', 'doctor', 'lint']) assert.match(h.stdout, new RegExp('\\b' + c + '\\b'));
    assert.match(runCli(['help', 'check'], { home }).stdout, /mlp check/);
    const u = runCli(['nope'], { home });
    assert.equal(u.code, 1);
    assert.match(u.stderr, /Unknown command/);
  } finally { rmDir(home); rmDir(other); }
});

test('check prints matches with scores and reasons, writes no state or log', () => {
  const home = makeHome();
  try {
    const r = runCli(['check', '--prompt', 'wrist and first person arms'], { home });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /fps-viewmodel-hands\s+score=20/);
    assert.match(r.stdout, /keyword:/);
    const f = runCli(['--json', 'check', '--file', 'C:\\g\\Player\\Hands\\rig.tscn'], { home });
    const j = JSON.parse(f.stdout);
    assert.equal(j[0].id, 'fps-viewmodel-hands');
    assert.equal(j[0].score, 100);
    const e = runCli(['check', '--error', 'Must use import to load ES Module'], { home });
    assert.match(e.stdout, /node-esm-require/);
    assert.match(runCli(['check', '--prompt', 'zzz nothing'], { home }).stdout, /No lessons match/);
    assert.equal(runCli(['check'], { home }).code, 1);
    assert.ok(!fs.existsSync(path.join(home, 'hits.jsonl')));
    assert.ok(!fs.existsSync(path.join(home, 'state')));
  } finally { rmDir(home); }
});

test('new / show / search / retire / lint / list', () => {
  const home = makeHome();
  try {
    const n = runCli(['new', 'my-lesson', '--title', 'My lesson'], { home });
    assert.equal(n.code, 0, n.stderr);
    const file = path.join(home, 'lessons', 'my-lesson.md');
    assert.equal(n.stdout.trim(), file);
    assert.match(fs.readFileSync(file, 'utf8'), /^---\nid: my-lesson\ntitle: My lesson\n/);
    assert.equal(runCli(['new', 'my-lesson'], { home }).code, 1);
    assert.equal(runCli(['new', 'Bad Id'], { home }).code, 1);

    const s = runCli(['show', 'node-esm-require'], { home });
    assert.match(s.stdout, /dynamic import\(\)/);
    assert.equal(runCli(['show', 'missing'], { home }).code, 1);
    assert.match(runCli(['search', 'ES MODULE'], { home }).stdout, /node-esm-require/);
    assert.match(runCli(['search', 'ISTANBUL'], { home }).stdout, /turkish-case/);

    const l = runCli(['list'], { home });
    assert.match(l.stdout, /fps-viewmodel-hands\s+active\s+godot,unity/);

    assert.equal(runCli(['retire', 'node-esm-require'], { home }).code, 0);
    assert.match(fs.readFileSync(path.join(home, 'lessons', 'node-esm-require.md'), 'utf8'), /\nstatus: retired\n/);
    assert.match(runCli(['check', '--error', 'Must use import to load ES Module'], { home }).stdout, /No lessons match/);
    assert.match(runCli(['list'], { home }).stdout, /node-esm-require\s+retired/);

    assert.equal(runCli(['lint'], { home }).code, 0);
    fs.writeFileSync(path.join(home, 'lessons', 'broken.md'), '---\nid: Broken\ntitle: x\nweird: 1\n---\n');
    fs.copyFileSync(path.join(home, 'lessons', 'turkish-case.md'), path.join(home, 'lessons', 'turkish-copy.md'));
    const lint = runCli(['lint'], { home });
    assert.equal(lint.code, 1);
    assert.match(lint.stdout, /unknown key "weird"/);
    assert.match(lint.stdout, /duplicate id "turkish-case"/);
    assert.match(lint.stdout, /empty body/);
  } finally { rmDir(home); }
});

test('feedback feeds stats, review and ranking', () => {
  const home = makeHome();
  try {
    assert.equal(runCli(['feedback', 'nope', 'wrong'], { home }).code, 1);
    assert.equal(runCli(['feedback', 'turkish-case', 'meh'], { home }).code, 1);
    assert.equal(runCli(['feedback', 'turkish-case', 'wrong', '--note', 'outdated'], { home }).code, 0);
    const fb = fs.readFileSync(path.join(home, 'feedback.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(fb[0].lesson, 'turkish-case');
    assert.equal(fb[0].verdict, 'wrong');
    assert.equal(fb[0].note, 'outdated');

    const { runHook } = require('./helpers');
    assert.ok(runHook('prompt', { prompt: 'wrist and first person arms', cwd: home, session_id: 'st' }, { home }).json);
    const st = runCli(['stats'], { home });
    assert.match(st.stdout, /1 injection/);
    assert.match(st.stdout, /fps-viewmodel-hands\s+1/);
    assert.match(st.stdout, /prompt\s+1/);
    const list = runCli(['list'], { home });
    assert.match(list.stdout, /fps-viewmodel-hands.*\s1\s+1\s/);
    const rv = runCli(['review'], { home });
    assert.match(rv.stdout, /Never hit:[\s\S]*node-esm-require/);
    assert.match(rv.stdout, /Marked wrong:[\s\S]*turkish-case/);
  } finally { rmDir(home); }
});

test('doctor reports hooks and lessons; exits 0 on a healthy setup', () => {
  const t = setup();
  try {
    const before = runCli(['doctor', '--settings', t.file], { home: t.home });
    assert.match(before.stdout, /\[OK\s*\] node/);
    assert.match(before.stdout, /\[WARN\] hooks\s+missing/);
    runCli(['install', '--settings', t.file], { home: t.home });
    const after = runCli(['doctor', '--settings', t.file], { home: t.home });
    assert.equal(after.code, 0, after.stdout);
    assert.match(after.stdout, /\[OK\s*\] hooks\s+all 5 present/);
    assert.match(after.stdout, /app copy\s+up to date/);
    assert.match(after.stdout, /\[OK\s*\] archive/);
    const j = JSON.parse(runCli(['--json', 'doctor', '--settings', t.file], { home: t.home }).stdout);
    assert.equal(j.ok, true);
  } finally { t.done(); }
});

test('project-local .lessons are loaded; id collisions get a local: prefix', () => {
  const home = makeHome({ only: ['turkish-case'] });
  const proj = tmpDir('proj');
  try {
    fs.mkdirSync(path.join(proj, '.git'));
    fs.mkdirSync(path.join(proj, '.lessons'));
    fs.writeFileSync(path.join(proj, '.lessons', 'turkish-case.md'), '---\nid: turkish-case\ntitle: Local one\nkeywords: zebra\n---\nLocal body');
    fs.writeFileSync(path.join(proj, '.lessons', 'solo.md'), '---\nid: solo\ntitle: Solo\nkeywords: zebra\n---\nSolo body');
    const r = runCli(['--json', 'check', '--prompt', 'zebra', '--cwd', proj], { home });
    assert.deepEqual(JSON.parse(r.stdout).map((x) => x.id).sort(), ['local:turkish-case', 'solo']);
    const lint = runCli(['lint'], { home, cwd: proj });
    assert.match(lint.stdout, /collides with a global lesson/);
  } finally { rmDir(home); rmDir(proj); }
});
