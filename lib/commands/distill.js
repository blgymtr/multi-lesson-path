'use strict';
const { distillMany, distillCandidate, pendingCandidateIds } = require('../distill');
const { listCandidates } = require('../harvest');
const { parseArgs } = require('../archive');

const summary = 'Turn candidates into draft lessons using your own `claude` CLI';
const usage = 'mlp distill [<candidate-id>|--all] [--model haiku] [--limit N] [--dry-run]';

async function run(args, ctx) {
  let a;
  try { a = parseArgs(args, { bool: ['all', 'dry-run'], str: ['model', 'limit'] }); } catch (e) { ctx.err(e.message); ctx.err(usage); return 1; }
  const f = a.flags;
  const limit = f.limit ? parseInt(f.limit, 10) : 0;
  let ids;
  if (a.rest.length) {
    ids = a.rest;
    const known = new Set(listCandidates(ctx.home).map((c) => c.id));
    const bad = ids.filter((i) => !known.has(i));
    if (bad.length) { ctx.err('unknown candidate: ' + bad.join(', ')); return 1; }
  } else if (f.all) ids = pendingCandidateIds(ctx.home, limit);
  else { ctx.err('give a candidate id or --all'); ctx.err(usage); return 1; }
  if (!ids.length) { ctx.out('nothing to distill'); return 0; }

  if (f['dry-run']) {
    for (const id of ids) {
      const r = await distillCandidate(id, { home: ctx.home, dryRun: true });
      ctx.out('===== ' + id + ' =====');
      ctx.out(r.prompt);
    }
    return 0;
  }
  const model = f.model || undefined;
  const results = await distillMany(ids, { home: ctx.home, model, concurrency: 3 }, (id, r) => {
    if (ctx.json) return;
    if (r.status === 'draft') ctx.out(id + ': draft ' + r.lessonId);
    else if (r.status === 'trivial') ctx.out(id + ': no generalizable lesson');
    else ctx.err(id + ': failed - ' + r.error);
  });
  if (ctx.json) ctx.out(JSON.stringify(results));
  else {
    const d = results.filter((r) => r.status === 'draft').length;
    ctx.out(d + ' draft(s) written. Review with `mlp drafts`, then `mlp accept <id>` or `mlp reject <id>`.');
  }
  return results.some((r) => r.status === 'error') ? 1 : 0;
}

module.exports = { summary, usage, run };
