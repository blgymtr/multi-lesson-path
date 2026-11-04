'use strict';
const lessons = require('../lessons');
const { output } = require('../format');

module.exports = {
  summary: 'Show one lesson',
  usage: 'mlp show <id>',
  run(args, ctx) {
    const id = args[0];
    if (!id) { ctx.err('usage: mlp show <id>'); return 1; }
    const l = lessons.findById(lessons.loadAll({ cwd: process.cwd() }), id);
    if (!l) { ctx.err('No lesson with id "' + id + '".'); return 1; }
    const data = Object.assign({}, l);
    delete data.issues;
    output(ctx, data, [
      l.id + ': ' + l.title,
      'file: ' + l.file + '  (' + l.scope + ', ' + l.status + ')',
      ...['keywords', 'strong', 'engines', 'paths', 'errors', 'projects'].filter((k) => l[k].length).map((k) => k + ': ' + l[k].join(', ')),
      ...(l.minMatch != null ? ['min_match: ' + l.minMatch] : []),
      ...(l.always ? ['always: true'] : []),
      'created: ' + (l.created || '-') + '  verified: ' + (l.verified || '-'),
      '',
      l.body,
    ]);
    return 0;
  },
};
