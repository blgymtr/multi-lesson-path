'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readTranscript, cleanUserText, listTranscripts } = require('../lib/transcripts');

const FIX = path.join(__dirname, 'fixtures', 'capture', 'session-alice.jsonl');

test('readTranscript normalizes events and strips injected content', async () => {
  const t = await readTranscript(FIX);
  assert.strictEqual(t.sessionId, 'sess-alice-1');
  assert.strictEqual(t.title, 'Fix the failing build');
  assert.strictEqual(t.summary, 'Installed missing foo dependency');
  assert.strictEqual(t.cwd, '/home/alice/proj');
  assert.strictEqual(t.project, 'proj');
  assert.ok(t.start && t.end && t.start <= t.end);
  const kinds = t.events.map((e) => e.kind);
  assert.deepStrictEqual(kinds, ['user', 'assistant', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'user',
    'assistant', 'tool_use', 'tool_result', 'tool_use', 'tool_result', 'user']);
  const users = t.events.filter((e) => e.kind === 'user').map((e) => e.text);
  assert.deepStrictEqual(users, ['Please run the tests for the project', 'still broken, same error', 'perfect thanks']);
  assert.ok(!t.events.some((e) => /sidechain|internal reminder/.test(e.text || '')));
});

test('tool_result events inherit tool and input from their tool_use', async () => {
  const t = await readTranscript(FIX);
  const r = t.events.find((e) => e.kind === 'tool_result');
  assert.strictEqual(r.tool, 'Bash');
  assert.strictEqual(r.input.command, 'npm test');
  assert.strictEqual(r.isError, true);
  assert.match(r.text, /Cannot find module/);
  assert.strictEqual(r.id, 'toolu_1');
});

test('long tool output and inputs are truncated to 2000 chars', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlp-tr-'));
  const f = path.join(dir, 's.jsonl');
  const big = 'x'.repeat(9000);
  const lines = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: big } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: big }] } }
  ].map((o) => JSON.stringify(o));
  fs.writeFileSync(f, lines.join('\n') + '\n');
  const t = await readTranscript(f);
  assert.ok(t.events[0].input.command.length <= 2001);
  assert.ok(t.events[1].text.length <= 2001);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lines over 5 MB and malformed lines are skipped without error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlp-tr-'));
  const f = path.join(dir, 's.jsonl');
  const huge = JSON.stringify({ type: 'user', message: { content: 'y'.repeat(5 * 1024 * 1024 + 10) } });
  const ok = JSON.stringify({ type: 'user', message: { content: 'hello there' } });
  fs.writeFileSync(f, huge + '\n{broken\n' + ok + '\n');
  const t = await readTranscript(f);
  assert.deepStrictEqual(t.events.map((e) => e.text), ['hello there']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cleanUserText strips known injections', () => {
  assert.strictEqual(cleanUserText('<system-reminder>x</system-reminder>'), '');
  assert.strictEqual(cleanUserText('hi <system-reminder>x\ny</system-reminder> there').replace(/\s+/g, ' '), 'hi there');
  assert.strictEqual(cleanUserText('<task-notification>done</task-notification>'), '');
  assert.strictEqual(cleanUserText('<local-command-stdout>a</local-command-stdout>'), '');
  assert.strictEqual(cleanUserText('[Request interrupted by user]'), '');
  assert.strictEqual(cleanUserText('real text'), 'real text');
});

test('listTranscripts ignores sub-agent directories and non-jsonl files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlp-tr-'));
  const slug = path.join(dir, 'proj-slug');
  fs.mkdirSync(path.join(slug, 'abc', 'subagents'), { recursive: true });
  fs.mkdirSync(path.join(slug, 'abc', 'tool-results'), { recursive: true });
  fs.writeFileSync(path.join(slug, 'abc.jsonl'), '{}\n');
  fs.writeFileSync(path.join(slug, 'abc', 'subagents', 'agent-1.jsonl'), '{}\n');
  fs.writeFileSync(path.join(slug, 'notes.txt'), 'x');
  const l = listTranscripts([dir]);
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].sessionId, 'abc');
  assert.strictEqual(l[0].slug, 'proj-slug');
  fs.rmSync(dir, { recursive: true, force: true });
});
