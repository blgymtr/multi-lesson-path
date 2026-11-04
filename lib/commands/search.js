'use strict';
const lessons = require('../lessons');
const { fold } = require('../normalize');
const { output } = require('../format');

module.exports = {
  summary: 'Substring search over id, title, keywords and body',
  usage: 'mlp search <text>',
  run(args, ctx) {
    const q = fold(args.join(' ')).trim();
    if (!q) { ctx.err('usage: mlp search <text>'); return 1; }
    const hits = lessons.loadAll({ cwd: process.cwd() }).filter((l) => fold([l.id, l.title, l.keywords.join(' '), l.strong.join(' '), l.body].join('\n')).includes(q));
    output(ctx, hits.map((l) => ({ id: l.id, title: l.title, status: l.status, file: l.file })),
      hits.length ? hits.map((l) => l.id + ' [' + l.status + ']  ' + l.title) : ['No lessons contain "' + args.join(' ') + '".']);
    return 0;
  },
};
