'use strict';
const lessons = require('../lessons');
const { appendFeedback } = require('../log');
const { parseArgs } = require('../cliargs');
const { output } = require('../format');

module.exports = {
  summary: 'Record whether an injected lesson was helpful or wrong',
  usage: 'mlp feedback <id> helpful|wrong [--note <text>]',
  run(args, ctx) {
    const a = parseArgs(args, { string: ['note'] });
    const [id, verdict] = a._;
    if (!id || !['helpful', 'wrong'].includes(verdict)) { ctx.err(this.usage); return 1; }
    const l = lessons.findById(lessons.loadAll({ cwd: process.cwd() }), id);
    if (!l) { ctx.err('No lesson with id "' + id + '".'); return 1; }
    const entry = { lesson: l.id, verdict };
    if (typeof a.note === 'string' && a.note) entry.note = a.note;
    appendFeedback(entry);
    output(ctx, entry, ['Recorded "' + verdict + '" for ' + l.id + '.']);
    return 0;
  },
};
