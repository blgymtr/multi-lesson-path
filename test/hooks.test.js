'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeHome, tmpDir, rmDir, runHook, runCli } = require('./helpers');

const ctxText = (r) => r.json.hookSpecificOutput.additionalContext;

test('prompt hook injects a matching lesson and nothing otherwise', () => {
  const home = makeHome();
  try {
    const none = runHook('prompt', { prompt: 'please write a haiku', cwd: home, session_id: 's1' }, { home });
    assert.equal(none.code, 0);
    assert.equal(none.stdout.trim(), '');

    const hit = runHook('prompt', { prompt: 'the wrist and first person arms look twisted', cwd: home, session_id: 's2' }, { home });
    assert.equal(hit.code, 0);
    assert.equal(hit.json.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(ctxText(hit), /^\[multi-lesson-path\] Lessons from earlier work that match this task\./);
    assert.match(ctxText(hit), /- fps-viewmodel-hands: FPS viewmodel hands/);
    assert.ok(ctxText(hit).length <= 2000);
    const keys = Object.keys(hit.json);
    assert.deepEqual(keys, ['hookSpecificOutput']);
    assert.doesNotMatch(hit.stdout, /permissionDecision|"decision"|"continue"/);

    const hits = fs.readFileSync(path.join(home, 'hits.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].lesson, 'fps-viewmodel-hands');
    assert.equal(hits[0].event, 'prompt');
    assert.equal(hits[0].session, 's2');
    assert.ok(hits[0].reasons.length > 0);
  } finally { rmDir(home); }
});

test('prompt hook de-duplicates per session', () => {
  const home = makeHome();
  try {
    const input = { prompt: 'wrist problem with the viewmodel', cwd: home, session_id: 'dedupe' };
    assert.ok(runHook('prompt', input, { home }).json);
    assert.equal(runHook('prompt', input, { home }).json, null);
    assert.ok(runHook('prompt', Object.assign({}, input, { session_id: 'other' }), { home }).json);
    assert.ok(fs.existsSync(path.join(home, 'state', 'dedupe.json')));
  } finally { rmDir(home); }
});

test('disabled file and MLP_DISABLE=1 silence every hook', () => {
  const home = makeHome();
  try {
    const input = { prompt: 'viewmodel wrist', cwd: home, session_id: 'x' };
    fs.writeFileSync(path.join(home, 'disabled'), '');
    assert.equal(runHook('prompt', input, { home }).stdout, '');
    fs.unlinkSync(path.join(home, 'disabled'));
    assert.equal(runHook('prompt', input, { home, env: { MLP_DISABLE: '1' } }).stdout, '');
    assert.ok(runHook('prompt', input, { home }).json);
  } finally { rmDir(home); }
});

test('garbage stdin and unknown kinds never fail or print', () => {
  const home = makeHome();
  try {
    for (const input of ['', 'not json', '[]', 'null', '{"prompt": 5}']) {
      const r = runCli(['hook', 'prompt'], { home, input });
      assert.equal(r.code, 0);
      assert.equal(r.stdout, '');
    }
    const r = runCli(['hook', 'bogus'], { home, input: '{}' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
  } finally { rmDir(home); }
});

test('edit hook matches by path and by content', () => {
  const home = makeHome();
  try {
    const byPath = runHook('edit', {
      hook_event_name: 'PreToolUse', tool_name: 'Write', cwd: home, session_id: 'e1',
      tool_input: { file_path: 'C:\\Users\\alice\\game\\Player\\Hands\\rig.tscn', content: 'x' },
    }, { home });
    assert.equal(byPath.json.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.match(ctxText(byPath), /match this file\./);
    assert.match(ctxText(byPath), /fps-viewmodel-hands/);

    const byContent = runHook('edit', {
      cwd: home, session_id: 'e2', tool_name: 'Edit',
      tool_input: { file_path: '/home/alice/x/notes.txt', old_string: 'a', new_string: 'fix the first person arms and the wrist' },
    }, { home });
    assert.match(ctxText(byContent), /fps-viewmodel-hands/);

    const nb = runHook('edit', {
      cwd: home, session_id: 'e3', tool_name: 'NotebookEdit',
      tool_input: { notebook_path: '/home/alice/x/ViewModel_test.ipynb', new_source: 'print(1)' },
    }, { home });
    assert.match(ctxText(nb), /fps-viewmodel-hands/);

    const miss = runHook('edit', { cwd: home, session_id: 'e4', tool_input: { file_path: '/home/alice/x/readme.md', content: 'hello' } }, { home });
    assert.equal(miss.stdout, '');
  } finally { rmDir(home); }
});

test('edit hook honours the engine filter', () => {
  const home = makeHome();
  const proj = tmpDir('proj');
  try {
    fs.writeFileSync(path.join(proj, 'package.json'), '{"dependencies":{"express":"1"}}');
    const r = runHook('edit', { cwd: proj, session_id: 'en', tool_input: { file_path: path.join(proj, 'ViewModel.js'), content: '' } }, { home });
    assert.equal(r.stdout, ''); // node project, lesson is godot/unity only
  } finally { rmDir(home); rmDir(proj); }
});

test('post-tool hook only fires on failed output (string and object responses)', () => {
  const home = makeHome();
  try {
    const ok = runHook('post-tool', {
      cwd: home, session_id: 'p1', tool_name: 'Bash', tool_input: { command: 'node x.js' },
      tool_response: { stdout: 'ERR_REQUIRE_ESM is just printed text, but fine', stderr: '', interrupted: false },
    }, { home });
    // output contains no failure word except via the lesson error string; "ERR_REQUIRE_ESM" has none of the regex words
    assert.equal(ok.stdout, '');

    const fail = runHook('post-tool', {
      cwd: home, session_id: 'p2', tool_name: 'Bash', tool_input: { command: 'node x.js' },
      tool_response: { stdout: '', stderr: 'Error [ERR_REQUIRE_ESM]: require() of ES Module failed', interrupted: false },
    }, { home });
    assert.equal(fail.json.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(ctxText(fail), /match this error\./);
    assert.match(ctxText(fail), /node-esm-require/);

    const asString = runHook('post-tool', {
      cwd: home, session_id: 'p3', tool_name: 'PowerShell', tool_input: { command: 'node x.js' },
      tool_response: 'exit code 1\nMust use import to load ES Module',
    }, { home });
    assert.match(ctxText(asString), /node-esm-require/);

    const isErr = runHook('post-tool', {
      cwd: home, session_id: 'p4', tool_name: 'Bash', tool_input: { command: 'node x.js' },
      tool_response: { stdout: 'Must use import to load ES Module', is_error: true },
    }, { home });
    assert.match(ctxText(isErr), /node-esm-require/);
  } finally { rmDir(home); }
});

test('session-start injects always lessons for matching cwd; compact resets de-dup', () => {
  const home = makeHome();
  try {
    const input = { cwd: '/home/alice/demo-project/app', session_id: 'ss', source: 'startup' };
    const first = runHook('session-start', input, { home });
    assert.equal(first.json.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(ctxText(first), /always-demo/);
    assert.equal(runHook('session-start', Object.assign({}, input, { source: 'resume' }), { home }).stdout, '');
    assert.match(ctxText(runHook('session-start', Object.assign({}, input, { source: 'compact' }), { home })), /always-demo/);
    assert.equal(runHook('session-start', { cwd: '/home/alice/elsewhere', session_id: 'ss2', source: 'startup' }, { home }).stdout, '');
  } finally { rmDir(home); }
});

test('session-end spawns a detached archive child and exits immediately', () => {
  const home = makeHome();
  try {
    const t0 = Date.now();
    const r = runHook('session-end', { session_id: 'se', transcript_path: path.join(home, 'nope.jsonl') }, { home });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
    assert.ok(Date.now() - t0 < 5000);
    assert.equal(runHook('session-end', { session_id: 'se' }, { home }).code, 0);
  } finally { rmDir(home); }
});

test('perf: 300 lessons, prompt hook in-process handler stays fast', () => {
  const home = tmpDir('perf');
  try {
    const dir = path.join(home, 'lessons');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 300; i++) {
      fs.writeFileSync(path.join(dir, `perf-${i}.md`),
        `---\nid: perf-${i}\ntitle: Synthetic lesson ${i}\nkeywords: alpha${i}, beta${i}, gamma${i}, delta rule ${i}\nengines: godot, unity\npaths: **/zone${i}/**\n---\n**Fix:** synthetic body ${i}. ${'lorem ipsum '.repeat(40)}\n`);
    }
    process.env.MLP_HOME = home;
    delete require.cache[require.resolve('../lib/hooks')];
    const hooks = require('../lib/hooks');
    const input = { prompt: 'please refactor the parser and add alpha7 plus beta7 handling ' + 'word '.repeat(150), cwd: home, session_id: 'perf' };
    hooks.handle('prompt', input); // warm up module loads
    fs.rmSync(path.join(home, 'state'), { recursive: true, force: true });
    const t0 = process.hrtime.bigint();
    const out = hooks.handle('prompt', input);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(out && /perf-7/.test(out));
    assert.ok(ms < 150, 'prompt handler took ' + ms.toFixed(1) + ' ms');
  } finally { delete process.env.MLP_HOME; rmDir(home); }
});

test('post-tool keyword matching ignores ordinary output lines', () => {
  const home = makeHome();
  try {
    // A failure happened, but the lesson's keywords appear only in unrelated output lines.
    const noisy = runHook('post-tool', {
      cwd: home, session_id: 'n1', tool_name: 'Bash', tool_input: { command: 'cat notes.md' },
      tool_response: { stdout: 'notes: es module and require esm discussion\nmore text\n\n\nsomething failed: disk quota', stderr: '' },
    }, { home });
    assert.equal(noisy.stdout, '');
    // The same keywords on the failing line itself still fire.
    const real = runHook('post-tool', {
      cwd: home, session_id: 'n2', tool_name: 'Bash', tool_input: { command: 'node app.js' },
      tool_response: { stdout: '', stderr: 'Error: cannot use import statement; es module loading failed' },
    }, { home });
    assert.match(ctxText(real), /node-esm-require/);
  } finally { rmDir(home); }
});

test('prompt hook ignores harness notifications and sub-agent reports', () => {
  const home = makeHome();
  try {
    const kw = 'require esm es module cannot use import';
    const agent = runHook('prompt', { cwd: home, session_id: 'm1', prompt: 'Another Claude session sent a message:\n<agent-message from="x">' + kw + '</agent-message>' }, { home });
    assert.equal(agent.stdout, '');
    const reminder = runHook('prompt', { cwd: home, session_id: 'm2', prompt: '<system-reminder>' + kw + '</system-reminder>\nthanks' }, { home });
    assert.equal(reminder.stdout, '');
    const mixed = runHook('prompt', { cwd: home, session_id: 'm3', prompt: '<system-reminder>noise</system-reminder>\n' + kw }, { home });
    assert.match(ctxText(mixed), /node-esm-require/);
  } finally { rmDir(home); }
});
