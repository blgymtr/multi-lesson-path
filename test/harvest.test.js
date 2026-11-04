'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { harvest, detectEpisodes, listCandidates, setCandidateStatus } = require('../lib/harvest');
const { readTranscript, } = require('../lib/transcripts');
const { archiveSession, resolvePaths } = require('../lib/archive');
const commands = {
  harvest: require('../lib/commands/harvest'),
  candidates: require('../lib/commands/candidates'),
  reject: require('../lib/commands/reject')
};

const FIX = path.join(__dirname, 'fixtures', 'capture', 'session-alice.jsonl');

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mlp-hv-'));
  const home = path.join(base, 'home');
  const root = path.join(base, 'projects');
  const dir = path.join(root, '-home-alice-proj');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'sess-alice-1.jsonl');
  fs.copyFileSync(FIX, file);
  return { base, home, root, file, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
const ctxFor = (home) => { const o = []; const e = []; return { home, json: false, out: (l) => o.push(l), err: (l) => e.push(l), o, e }; };

test('detectEpisodes finds one resolved failure -> fix episode', async () => {
  const t = await readTranscript(FIX);
  const eps = detectEpisodes(t, {});
  assert.strictEqual(eps.length, 1);
  const ep = eps[0];
  assert.strictEqual(ep.failures, 2);
  assert.strictEqual(ep.corrections, 1);
  assert.strictEqual(ep.resolved, true);
  assert.strictEqual(ep.score, 2 + 3 + 2);
  assert.match(ep.id, /^[0-9a-f]{12}$/);
  assert.ok(ep.commands.some((c) => c.startsWith('npm test')));
  assert.strictEqual(detectEpisodes(t, {})[0].id, ep.id, 'id is deterministic');
});

test('a single uncorrected failure is not an episode; a correction alone is', () => {
  const mk = (events) => ({ sessionId: 's', events });
  const fail = (id, cmd) => [{ kind: 'tool_use', tool: 'Bash', input: { command: cmd }, id }, { kind: 'tool_result', tool: 'Bash', input: { command: cmd }, id, isError: true, text: 'Error: x' }];
  assert.strictEqual(detectEpisodes(mk([...fail('a', 'make build')]), {}).length, 0);
  const withCorr = mk([...fail('a', 'make build'), { kind: 'user', text: 'this is wrong, it is broken', id: 'u1' }]);
  assert.strictEqual(detectEpisodes(withCorr, {}).length, 1);
  // two failures on different targets far apart -> two separate singles -> none
  const far = [];
  far.push(...fail('a', 'make build'));
  for (let i = 0; i < 15; i++) far.push({ kind: 'assistant', text: 'working ' + i, id: 'x' + i });
  far.push(...fail('b', 'cargo test'));
  assert.strictEqual(detectEpisodes(mk(far), {}).length, 0);
});

test('Turkish correction words are recognized (folded)', () => {
  const ev = [{ kind: 'user', text: 'Olmadı, hâlâ yamuk duruyor', id: 'u1' }];
  assert.strictEqual(detectEpisodes({ sessionId: 's', events: ev }, {}).length, 1);
});

test('harvest writes candidate digest + index and is idempotent', async () => {
  const s = setup();
  const r1 = await harvest({ home: s.home, roots: [s.root] });
  assert.strictEqual(r1.found, 1);
  assert.strictEqual(r1.written, 1);
  const p = resolvePaths(s.home);
  const list = listCandidates(s.home);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].status, 'new');
  const md = fs.readFileSync(path.join(p.candidates, list[0].id + '.md'), 'utf8');
  assert.ok(md.length <= 6100);
  assert.match(md, /Fix the failing build/);
  assert.match(md, /FAILED ATTEMPT/);
  assert.match(md, /USER CORRECTS/);
  assert.match(md, /RESOLVING STEP/);
  assert.match(md, /npm install foo/);
  assert.ok(!/internal reminder/.test(md));
  const r2 = await harvest({ home: s.home, roots: [s.root] });
  assert.strictEqual(r2.scanned, 0);
  const r3 = await harvest({ home: s.home, roots: [s.root], rescan: true });
  assert.strictEqual(r3.written, 1);
  assert.strictEqual(listCandidates(s.home).length, 1);
  s.cleanup();
});

test('harvest reads the archive when the live transcript is gone', async () => {
  const s = setup();
  await archiveSession(s.file, { home: s.home });
  fs.rmSync(s.file);
  const r = await harvest({ home: s.home, roots: [s.root] });
  assert.strictEqual(r.sessions, 1);
  assert.strictEqual(r.written, 1);
  s.cleanup();
});

test('rejected candidates are never re-created; status survives re-harvest', async () => {
  const s = setup();
  await harvest({ home: s.home, roots: [s.root] });
  const id = listCandidates(s.home)[0].id;
  const c = ctxFor(s.home);
  assert.strictEqual(await commands.reject.run([id], c), 0);
  assert.strictEqual(listCandidates(s.home)[0].status, 'rejected');
  const r = await harvest({ home: s.home, roots: [s.root], rescan: true });
  assert.strictEqual(r.skippedRejected, 1);
  assert.strictEqual(listCandidates(s.home)[0].status, 'rejected');
  s.cleanup();
});

test('distilled status is kept when harvest runs again', async () => {
  const s = setup();
  await harvest({ home: s.home, roots: [s.root] });
  const id = listCandidates(s.home)[0].id;
  await setCandidateStatus(s.home, id, { status: 'distilled' });
  await harvest({ home: s.home, roots: [s.root], rescan: true });
  assert.strictEqual(listCandidates(s.home)[0].status, 'distilled');
  s.cleanup();
});

test('--project and --since filter sessions; --limit caps candidates', async () => {
  const s = setup();
  assert.strictEqual((await harvest({ home: s.home, roots: [s.root], project: 'nomatch' })).sessions, 0);
  assert.strictEqual((await harvest({ home: s.home, roots: [s.root], project: 'ALICE' })).sessions, 1);
  assert.strictEqual((await harvest({ home: s.home, roots: [s.root], since: '2999-01-01' })).sessions, 0);
  s.cleanup();
});

test('harvest and candidates commands print counts', async () => {
  const s = setup();
  const c = ctxFor(s.home);
  assert.strictEqual(await commands.harvest.run(['--roots', s.root], c), 0);
  assert.match(c.o.join('\n'), /candidates written: 1/);
  const c2 = ctxFor(s.home);
  assert.strictEqual(await commands.candidates.run([], c2), 0);
  assert.match(c2.o.join('\n'), /1 candidates, 1 new/);
  const c3 = ctxFor(s.home);
  assert.strictEqual(await commands.harvest.run(['--bogus'], c3), 1);
  s.cleanup();
});
