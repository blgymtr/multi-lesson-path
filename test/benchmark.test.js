'use strict';
// End-to-end test of the token-cost benchmark with a fake claude binary. Nothing here
// calls a real model or touches the real MLP_HOME.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpDir, rmDir, ROOT } = require('./helpers');

const BENCH = path.join(ROOT, 'benchmarks', 'token-cost');

const FAKE = `
const { spawnSync } = require('child_process');
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  if (process.env.FAKE_SOLUTION) spawnSync(process.execPath, [process.env.FAKE_SOLUTION], { cwd: process.cwd() });
  const off = process.env.MLP_DISABLE === '1';
  process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false,
    total_cost_usd: off ? 0.04 : 0.02, num_turns: off ? 9 : 4, duration_ms: 1234,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: off ? 4000 : 1000, cache_creation_input_tokens: 200 },
    prompt_seen: input.length > 0,
  }));
});
`;

function envWithout(extra, drop) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.MLP_HOME;
  for (const k of drop || []) delete env[k];
  return env;
}

test('run.js + report.js work end to end with a fake claude', () => {
  const dir = tmpDir('bench');
  try {
    const fake = path.join(dir, 'fake-claude.js');
    fs.writeFileSync(fake, FAKE);
    const out = path.join(dir, 'results.jsonl');
    const task = 'config-override';
    const env = envWithout({ FAKE_SOLUTION: path.join(BENCH, 'tasks', task, 'solution.js') });
    const r = spawnSync(process.execPath, [path.join(BENCH, 'run.js'), '--tasks', task, '--reps', '1', '--claude', fake, '--out', out],
      { encoding: 'utf8', env, timeout: 120000 });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);

    const rows = fs.readFileSync(out, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l));
    assert.strictEqual(rows.length, 2);
    const off = rows.find((x) => x.condition === 'off');
    const on = rows.find((x) => x.condition === 'on');
    assert.ok(off && on);
    for (const x of rows) {
      assert.strictEqual(x.task, task);
      assert.strictEqual(x.success, true);
      assert.strictEqual(x.error, null);
      assert.strictEqual(x.total_tokens, 100 + 50 + 200 + (x.condition === 'off' ? 4000 : 1000));
    }
    assert.strictEqual(off.cost_usd, 0.04);
    assert.strictEqual(on.cost_usd, 0.02);
    assert.strictEqual(off.turns, 9);

    const md = path.join(dir, 'RESULTS.md');
    const svg = path.join(dir, 'chart.svg');
    const rep = spawnSync(process.execPath, [path.join(BENCH, 'report.js'), out, '--md', md, '--svg', svg], { encoding: 'utf8' });
    assert.strictEqual(rep.status, 0, rep.stderr);
    assert.match(rep.stdout, /config-override/);
    assert.match(rep.stdout, /-50\.0%/);
    const mdText = fs.readFileSync(md, 'utf8');
    assert.match(mdText, /## Limitations/);
    assert.match(mdText, /Cost per solved task/);
    const svgText = fs.readFileSync(svg, 'utf8');
    assert.match(svgText, /^<svg [^>]*width="\d+" height="\d+" viewBox="0 0 \d+ \d+"/);
    assert.ok(svgText.trimEnd().endsWith('</svg>'));
  } finally { rmDir(dir); }
});

test('a fake that does not fix anything is recorded as not solved', () => {
  const dir = tmpDir('bench');
  try {
    const fake = path.join(dir, 'fake-claude.js');
    fs.writeFileSync(fake, FAKE);
    const out = path.join(dir, 'results.jsonl');
    const r = spawnSync(process.execPath, [path.join(BENCH, 'run.js'), '--tasks', 'control-clamp', '--reps', '1', '--conditions', 'on', '--claude', fake, '--out', out],
      { encoding: 'utf8', env: envWithout({}, ['FAKE_SOLUTION']), timeout: 120000 });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const row = JSON.parse(fs.readFileSync(out, 'utf8').trim());
    assert.strictEqual(row.success, false);
  } finally { rmDir(dir); }
});

test('dry run: every task fails untouched and passes with its intended fix', () => {
  const r = spawnSync(process.execPath, [path.join(BENCH, 'run.js'), '--dry-run'], { encoding: 'utf8', env: envWithout(), timeout: 120000 });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /pre-solved|unsolvable/);
});
