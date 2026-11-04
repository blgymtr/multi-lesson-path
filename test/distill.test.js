'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { distillCandidate, extractJsonObject, parseReply, buildPrompt } = require('../lib/distill');
const { harvest, listCandidates } = require('../lib/harvest');
const { resolvePaths } = require('../lib/archive');
const cmd = {
  distill: require('../lib/commands/distill'),
  drafts: require('../lib/commands/drafts'),
  accept: require('../lib/commands/accept'),
  reject: require('../lib/commands/reject')
};

const FIX = path.join(__dirname, 'fixtures', 'capture', 'session-alice.jsonl');
const FAKE = path.join(__dirname, 'fixtures', 'capture', 'fake-claude.js');

async function setup(mode) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mlp-ds-'));
  const home = path.join(base, 'home');
  const root = path.join(base, 'projects', '-home-alice-proj');
  fs.mkdirSync(root, { recursive: true });
  fs.copyFileSync(FIX, path.join(root, 'sess-alice-1.jsonl'));
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ claudeBin: FAKE }));
  await harvest({ home, roots: [path.join(base, 'projects')] });
  process.env.FAKE_CLAUDE_MODE = mode || 'ok';
  process.env.FAKE_CLAUDE_LOG = path.join(base, 'calls.log');
  return { base, home, id: listCandidates(home)[0].id, log: process.env.FAKE_CLAUDE_LOG, cleanup: () => { delete process.env.FAKE_CLAUDE_MODE; delete process.env.FAKE_CLAUDE_LOG; fs.rmSync(base, { recursive: true, force: true }); } };
}
const ctxFor = (home) => { const o = []; const e = []; return { home, json: false, out: (l) => o.push(l), err: (l) => e.push(l), o, e }; };

test('extractJsonObject handles prose, fences and braces inside strings', () => {
  assert.deepStrictEqual(extractJsonObject('x {"a": "}{"} y'), { a: '}{' });
  assert.deepStrictEqual(extractJsonObject('```json\n{"lesson": null}\n```'), { lesson: null });
  assert.strictEqual(extractJsonObject('no json here'), null);
  assert.deepStrictEqual(extractJsonObject('{bad} then {"ok": 1}'), { ok: 1 });
});

test('parseReply unwraps the CLI envelope and normalizes the lesson', () => {
  const env = JSON.stringify({ type: 'result', is_error: false, result: 'Sure:\n{"lesson": {"id": "Hello World!", "title": " T ", "keywords": "a, b", "body": "**Fix:** x"}}' });
  const r = parseReply(env);
  assert.strictEqual(r.lesson.id, 'hello-world');
  assert.deepStrictEqual(r.lesson.keywords, ['a', 'b']);
  assert.deepStrictEqual(parseReply(JSON.stringify({ result: '{"lesson": null}' })), { lesson: null });
  assert.throws(() => parseReply(JSON.stringify({ result: 'nothing' })), /lesson/);
  assert.throws(() => parseReply(JSON.stringify({ is_error: true, result: 'quota' })), /quota/);
});

test('prompt demands generalizable, bilingual, three-part lessons', () => {
  const p = buildPrompt('DIGEST-BODY');
  assert.match(p, /DIGEST-BODY/);
  assert.match(p, /GENERALIZABLE/);
  assert.match(p, /\{"lesson": null\}/);
  assert.match(p, /Didn't work/);
  assert.match(p, /BOTH/);
});

test('distill with a fake claude writes a draft and marks the candidate', async () => {
  const s = await setup('ok');
  const r = await distillCandidate(s.id, { home: s.home });
  assert.strictEqual(r.status, 'draft');
  assert.strictEqual(r.lessonId, 'missing-dependency-not-installed');
  const p = resolvePaths(s.home);
  const text = fs.readFileSync(path.join(p.drafts, s.id + '.md'), 'utf8');
  assert.match(text, /^---\nid: missing-dependency-not-installed\n/);
  assert.match(text, /status: draft/);
  assert.match(text, new RegExp('source: candidate ' + s.id));
  assert.match(text, /engines: node/);
  assert.match(text, /\*\*Root cause:\*\*/);
  const c = listCandidates(s.home)[0];
  assert.strictEqual(c.status, 'distilled');
  assert.strictEqual(c.draft, s.id);
  // CLI invocation contract
  const call = JSON.parse(fs.readFileSync(s.log, 'utf8').trim().split('\n')[0]);
  assert.deepStrictEqual(call.argv, ['-p', '--model', 'haiku', '--output-format', 'json', '--max-turns', '1',
    '--no-session-persistence', '--strict-mcp-config']);
  assert.match(call.stdin, /FAILED ATTEMPT/);
  assert.strictEqual(call.mlpDisable, '1');
  s.cleanup();
});

test('distill handles fenced/prose replies and trivial answers', async () => {
  let s = await setup('fence');
  assert.strictEqual((await distillCandidate(s.id, { home: s.home })).status, 'draft');
  s.cleanup();
  s = await setup('trivial');
  const r = await distillCandidate(s.id, { home: s.home });
  assert.strictEqual(r.status, 'trivial');
  assert.ok(!fs.existsSync(path.join(resolvePaths(s.home).drafts, s.id + '.md')));
  const c = listCandidates(s.home)[0];
  assert.strictEqual(c.status, 'distilled');
  assert.strictEqual(c.trivial, true);
  s.cleanup();
});

test('distill errors surface and leave the candidate new', async () => {
  let s = await setup('garbage');
  await assert.rejects(distillCandidate(s.id, { home: s.home }), /lesson/);
  assert.strictEqual(listCandidates(s.home)[0].status, 'new');
  s.cleanup();
  s = await setup('fail');
  await assert.rejects(distillCandidate(s.id, { home: s.home }), /code 3/);
  s.cleanup();
});

test('distill honours the timeout', async () => {
  const s = await setup('slow');
  await assert.rejects(distillCandidate(s.id, { home: s.home, timeoutMs: 300 }), /timed out/);
  s.cleanup();
});

test('--dry-run prints the prompt without calling claude', async () => {
  const s = await setup('ok');
  const c = ctxFor(s.home);
  assert.strictEqual(await cmd.distill.run([s.id, '--dry-run'], c), 0);
  assert.match(c.o.join('\n'), /EPISODE DIGEST/);
  assert.ok(!fs.existsSync(s.log));
  s.cleanup();
});

test('distill --all, drafts, accept, reject commands', async () => {
  const s = await setup('ok');
  const c = ctxFor(s.home);
  assert.strictEqual(await cmd.distill.run(['--all'], c), 0);
  assert.match(c.o.join('\n'), /1 draft/);
  const c2 = ctxFor(s.home);
  await cmd.drafts.run([], c2);
  assert.match(c2.o.join('\n'), /missing-dependency-not-installed/);
  const c3 = ctxFor(s.home);
  const code = await cmd.accept.run(['missing-dependency-not-installed'], c3);
  const hasLessons = fs.existsSync(path.join(__dirname, '..', 'lib', 'lessons.js'));
  if (hasLessons && code !== 0) assert.fail('accept failed: ' + c3.e.join('; '));
  assert.strictEqual(code, 0, c3.e.join('; '));
  const p = resolvePaths(s.home);
  const accepted = fs.readFileSync(path.join(p.lessons, 'missing-dependency-not-installed.md'), 'utf8');
  assert.ok(!/status: draft/.test(accepted));
  assert.ok(!fs.existsSync(path.join(p.drafts, s.id + '.md')));
  s.cleanup();
});

test('reject on a draft hides it and blocks re-harvest', async () => {
  const s = await setup('ok');
  await distillCandidate(s.id, { home: s.home });
  const c = ctxFor(s.home);
  assert.strictEqual(await cmd.reject.run(['missing-dependency-not-installed'], c), 0);
  const c2 = ctxFor(s.home);
  await cmd.drafts.run([], c2);
  assert.match(c2.o.join('\n'), /no drafts/);
  assert.strictEqual(listCandidates(s.home)[0].status, 'rejected');
  s.cleanup();
});

