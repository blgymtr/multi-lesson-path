'use strict';
const lessons = require('../lessons');
const { readHits, hitStats, feedbackCounts } = require('../log');
const { parseArgs } = require('../cliargs');
const { output } = require('../format');

module.exports = {
  summary: 'Find lessons that are never hit, stale, or marked wrong; lint warnings',
  usage: 'mlp review [--days 60]',
  run(args, ctx) {
    const a = parseArgs(args, { string: ['days'] });
    const days = Number(a.days) > 0 ? Number(a.days) : 60;
    const cutoff = Date.now() - days * 86400000;
    const stats = hitStats(readHits(), days);
    const fb = feedbackCounts();
    const active = lessons.loadAll({ cwd: process.cwd() }).filter((l) => l.status === 'active');
    const never = [];
    const stale = [];
    const wrong = [];
    for (const l of active) {
      const s = stats[l.id];
      if (!s) never.push(l.id);
      else if (Date.parse(s.last) < cutoff) stale.push(l.id + ' (last hit ' + s.last.slice(0, 10) + ')');
      if (fb[l.id] && fb[l.id].wrong) wrong.push(l.id + ' (wrong x' + fb[l.id].wrong + ', helpful x' + fb[l.id].helpful + ')');
    }
    const warnings = lessons.lintAll(active).filter((r) => r.warnings.length || r.errors.length)
      .map((r) => ({ id: r.lesson.id || r.lesson.file, messages: r.errors.concat(r.warnings) }));
    const lines = [];
    const section = (title, items) => { if (items.length) lines.push(title, ...items.map((i) => '  ' + i), ''); };
    section('Never hit:', never);
    section('Not hit in ' + days + ' days:', stale);
    section('Marked wrong:', wrong);
    section('Lint:', warnings.flatMap((w) => w.messages.map((m) => w.id + ': ' + m)));
    if (!lines.length) lines.push('Nothing to review: ' + active.length + ' active lesson(s) look healthy.');
    output(ctx, { days, never, stale, wrong, lint: warnings }, lines);
    return 0;
  },
};
