'use strict';
const path = require('path');
const { archiveSession, archiveAll, parseArgs } = require('../archive');

const summary = 'Archive transcripts into condensed gzip files (survives Claude Code cleanup)';
const usage = 'mlp archive [--transcript <file>] [--all] [--full] [--roots <dir,...>]';

async function run(args, ctx) {
  let a;
  try { a = parseArgs(args, { bool: ['all', 'full'], str: ['transcript', 'roots'] }); } catch (e) { ctx.err(e.message); ctx.err(usage); return 1; }
  const f = a.flags;
  if (!f.transcript && !f.all) { ctx.err('give --transcript <file> or --all'); ctx.err(usage); return 1; }
  const roots = f.roots ? f.roots.split(',').map((s) => s.trim()).filter(Boolean) : null;
  try {
    if (f.transcript) {
      const r = await archiveSession(path.resolve(f.transcript), { home: ctx.home, full: !!f.full });
      if (ctx.json) ctx.out(JSON.stringify(r)); else ctx.out(r.status + ': ' + r.sessionId + (r.events != null ? ' (' + r.events + ' events)' : ''));
      return 0;
    }
    const stats = await archiveAll({ home: ctx.home, full: !!f.full, roots });
    if (ctx.json) ctx.out(JSON.stringify(stats));
    else ctx.out('transcripts: ' + stats.total + ', archived: ' + stats.archived + ', unchanged: ' + stats.skipped + ', empty: ' + stats.empty + ', failed: ' + stats.failed);
    return stats.failed ? 1 : 0;
  } catch (e) {
    ctx.err('archive failed: ' + e.message);
    return 1;
  }
}

module.exports = { summary, usage, run };
