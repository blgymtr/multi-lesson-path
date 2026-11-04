'use strict';
const { harvest } = require('../harvest');
const { parseArgs } = require('../archive');

const summary = 'Find failure -> fix episodes in transcripts and write candidate digests';
const usage = 'mlp harvest [--since <date>] [--project <substr>] [--limit N] [--roots <dir,...>] [--rescan]';

async function run(args, ctx) {
  let a;
  try { a = parseArgs(args, { bool: ['rescan'], str: ['since', 'project', 'limit', 'roots'] }); } catch (e) { ctx.err(e.message); ctx.err(usage); return 1; }
  const f = a.flags;
  const limit = f.limit ? parseInt(f.limit, 10) : 200;
  if (f.limit && !(limit > 0)) { ctx.err('--limit must be a positive number'); return 1; }
  try {
    const s = await harvest({
      home: ctx.home, since: f.since, project: f.project, limit, rescan: !!f.rescan,
      roots: f.roots ? f.roots.split(',').map((x) => x.trim()).filter(Boolean) : null
    });
    if (ctx.json) ctx.out(JSON.stringify(s));
    else {
      ctx.out('sessions: ' + s.sessions + ', scanned: ' + s.scanned + ', episodes found: ' + s.found + ', candidates written: ' + s.written +
        (s.skippedRejected ? ', rejected (skipped): ' + s.skippedRejected : '') + (s.failed ? ', unreadable: ' + s.failed : ''));
      if (s.written) ctx.out('next: mlp candidates   then   mlp distill --all');
    }
    return 0;
  } catch (e) {
    ctx.err('harvest failed: ' + e.message);
    return 1;
  }
}

module.exports = { summary, usage, run };
