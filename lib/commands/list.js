'use strict';
const lessons = require('../lessons');
const { readHits, hitStats } = require('../log');
const { output, table } = require('../format');

module.exports = {
  summary: 'List lessons with status, engines and hit counts',
  usage: 'mlp list',
  run(args, ctx) {
    const all = lessons.loadAll({ cwd: process.cwd() });
    const stats = hitStats(readHits(), 30);
    const rows = all.map((l) => {
      const s = stats[l.id] || { total: 0, recent: 0, last: '' };
      return {
        id: l.id || '(no id)', status: l.status, engines: l.engines, scope: l.scope,
        hits: s.total, hits30: s.recent, lastHit: s.last || null, file: l.file,
      };
    });
    const lines = rows.length
      ? table([['ID', 'STATUS', 'ENGINES', 'HITS', '30D', 'LAST HIT']].concat(rows.map((r) => [
        r.id, r.status, r.engines.join(',') || '-', String(r.hits), String(r.hits30), r.lastHit ? r.lastHit.slice(0, 10) : '-',
      ])))
      : ['No lessons yet. Create one with `mlp new <id>`.'];
    output(ctx, rows, lines);
    return 0;
  },
};
