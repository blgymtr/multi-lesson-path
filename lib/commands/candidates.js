'use strict';
const { listCandidates } = require('../harvest');

const summary = 'List harvested candidates (new / distilled / rejected)';
const usage = 'mlp candidates [--json]';

async function run(args, ctx) {
  const list = listCandidates(ctx.home);
  if (ctx.json || (args || []).includes('--json')) { ctx.out(JSON.stringify(list)); return 0; }
  if (!list.length) { ctx.out('no candidates yet - run `mlp harvest`'); return 0; }
  for (const c of list) {
    const st = c.status === 'distilled' && c.trivial ? 'distilled (no lesson)' : c.status;
    ctx.out(c.id + '  ' + String(st).padEnd(8) + ' score ' + String(c.score != null ? c.score : '?').padStart(3) + '  ' + (c.resolved ? 'resolved  ' : 'unresolved') + '  ' + (c.project || '-') + '  ' + (c.title || ''));
  }
  const n = list.filter((c) => c.status === 'new').length;
  ctx.out(list.length + ' candidates, ' + n + ' new');
  return 0;
}

module.exports = { summary, usage, run };
