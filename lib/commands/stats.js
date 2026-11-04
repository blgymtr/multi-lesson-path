'use strict';
const { readHits } = require('../log');
const { parseArgs } = require('../cliargs');
const { output, table } = require('../format');

module.exports = {
  summary: 'Hits per lesson and per event',
  usage: 'mlp stats [--days 30]',
  run(args, ctx) {
    const a = parseArgs(args, { string: ['days'] });
    const days = Number(a.days) > 0 ? Number(a.days) : 30;
    const cutoff = Date.now() - days * 86400000;
    const hits = readHits().filter((h) => h && h.lesson && Date.parse(h.ts) >= cutoff);
    const perLesson = {};
    const perEvent = {};
    for (const h of hits) {
      perLesson[h.lesson] = (perLesson[h.lesson] || 0) + 1;
      const ev = h.event || 'unknown';
      perEvent[ev] = (perEvent[ev] || 0) + 1;
    }
    const byCount = (o) => Object.entries(o).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    const lines = ['Last ' + days + ' days: ' + hits.length + ' injection(s).'];
    if (hits.length) {
      lines.push('', 'Per lesson:', ...table([['LESSON', 'HITS']].concat(byCount(perLesson).map(([k, v]) => [k, String(v)]))));
      lines.push('', 'Per event:', ...table([['EVENT', 'HITS']].concat(byCount(perEvent).map(([k, v]) => [k, String(v)]))));
    }
    output(ctx, { days, total: hits.length, perLesson, perEvent }, lines);
    return 0;
  },
};
