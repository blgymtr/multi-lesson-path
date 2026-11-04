'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { archiveSession, archiveAll, loadIndex, resolvePaths, updateJson } = require('../lib/archive');
const { readArchived, readTranscript } = require('../lib/transcripts');

const FIX = path.join(__dirname, 'fixtures', 'capture', 'session-alice.jsonl');

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mlp-ar-'));
  const home = path.join(base, 'home');
  const root = path.join(base, 'projects');
  const dir = path.join(root, '-home-alice-proj');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'sess-alice-1.jsonl');
  fs.copyFileSync(FIX, file);
  return { base, home, root, file, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('archiveSession writes a condensed gz and an index entry; readArchived round-trips', async () => {
  const s = setup();
  const r = await archiveSession(s.file, { home: s.home });
  assert.strictEqual(r.status, 'archived');
  const p = resolvePaths(s.home);
  const gz = path.join(p.archive, '-home-alice-proj', 'sess-alice-1.jsonl.gz');
  assert.ok(fs.existsSync(gz));
  const idx = loadIndex(s.home);
  const e = idx.sessions['sess-alice-1'];
  assert.strictEqual(e.events, 13);
  assert.strictEqual(e.size, fs.statSync(s.file).size);
  assert.ok(e.archivedAt && e.source);
  const orig = await readTranscript(s.file);
  const back = await readArchived(gz);
  assert.strictEqual(back.title, orig.title);
  assert.strictEqual(back.cwd, orig.cwd);
  assert.deepStrictEqual(back.events, orig.events);
  s.cleanup();
});

test('archive is idempotent and re-archives when the source changes', async () => {
  const s = setup();
  assert.strictEqual((await archiveSession(s.file, { home: s.home })).status, 'archived');
  assert.strictEqual((await archiveSession(s.file, { home: s.home })).status, 'skipped');
  fs.appendFileSync(s.file, JSON.stringify({ type: 'user', message: { content: 'one more message' } }) + '\n');
  assert.strictEqual((await archiveSession(s.file, { home: s.home })).status, 'archived');
  assert.strictEqual(loadIndex(s.home).sessions['sess-alice-1'].events, 14);
  s.cleanup();
});

test('--full keeps the raw transcript gzip', async () => {
  const s = setup();
  const r = await archiveSession(s.file, { home: s.home, full: true });
  assert.strictEqual(r.status, 'archived');
  assert.strictEqual(zlib.gunzipSync(fs.readFileSync(r.file)).toString('utf8'), fs.readFileSync(s.file, 'utf8'));
  const back = await readArchived(r.file, { slug: '-home-alice-proj', sessionId: 'sess-alice-1' });
  assert.strictEqual(back.events.length, 13);
  s.cleanup();
});

test('empty transcripts are not archived', async () => {
  const s = setup();
  const f = path.join(path.dirname(s.file), 'empty.jsonl');
  fs.writeFileSync(f, '{"type":"queue-operation"}\n');
  assert.strictEqual((await archiveSession(f, { home: s.home })).status, 'empty');
  assert.ok(!loadIndex(s.home).sessions.empty);
  s.cleanup();
});

test('archiveAll finds transcripts under roots and skips unchanged ones', async () => {
  const s = setup();
  const a = await archiveAll({ home: s.home, roots: [s.root] });
  assert.deepStrictEqual([a.total, a.archived, a.skipped], [1, 1, 0]);
  const b = await archiveAll({ home: s.home, roots: [s.root] });
  assert.deepStrictEqual([b.total, b.archived, b.skipped], [1, 0, 1]);
  s.cleanup();
});

test('concurrent index updates do not lose entries', async () => {
  const s = setup();
  const idx = path.join(s.base, 'x', 'index.json');
  await Promise.all(Array.from({ length: 12 }, (_, i) => updateJson(idx, { n: {} }, (o) => { o.n['k' + i] = i; return o; })));
  const o = JSON.parse(fs.readFileSync(idx, 'utf8'));
  assert.strictEqual(Object.keys(o.n).length, 12);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(idx)).filter((f) => f.endsWith('.lock') || f.endsWith('.tmp')), []);
  s.cleanup();
});

test('concurrent archive of different sessions keeps every index entry', async () => {
  const s = setup();
  const files = [];
  for (let i = 0; i < 5; i++) {
    const f = path.join(path.dirname(s.file), 'conc-' + i + '.jsonl');
    fs.copyFileSync(FIX, f);
    files.push(f);
  }
  await Promise.all(files.map((f) => archiveSession(f, { home: s.home })));
  const sessions = loadIndex(s.home).sessions;
  for (let i = 0; i < 5; i++) assert.ok(sessions['conc-' + i], 'missing conc-' + i);
  s.cleanup();
});
