'use strict';
const fs = require('fs');
const lessons = require('../lessons');
const { output } = require('../format');

module.exports = {
  summary: 'Retire a lesson (sets status: retired; it never matches again)',
  usage: 'mlp retire <id>',
  run(args, ctx) {
    const id = args[0];
    if (!id) { ctx.err(this.usage); return 1; }
    const l = lessons.findById(lessons.loadAll({ cwd: process.cwd() }), id);
    if (!l) { ctx.err('No lesson with id "' + id + '".'); return 1; }
    const text = fs.readFileSync(l.file, 'utf8');
    fs.writeFileSync(l.file, lessons.setFrontMatterKey(text, 'status', 'retired'));
    output(ctx, { id: l.id, file: l.file, status: 'retired' }, ['Retired ' + l.id + ' (' + l.file + ').']);
    return 0;
  },
};
