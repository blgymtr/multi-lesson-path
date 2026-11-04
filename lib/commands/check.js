'use strict';
const fs = require('fs');
const path = require('path');
const lessons = require('../lessons');
const { evaluate } = require('../match');
const { feedbackCounts } = require('../log');
const { parseArgs } = require('../cliargs');
const { output } = require('../format');

module.exports = {
  summary: 'Dry run: show which lessons would fire (no state, no log)',
  usage: 'mlp check (--prompt <text> | --file <path> | --error <text>) [--cwd <dir>]',
  run(args, ctx) {
    const a = parseArgs(args, { string: ['prompt', 'file', 'error', 'cwd'] });
    const str = (v) => (typeof v === 'string' ? v : '');
    const prompt = str(a.prompt);
    const file = str(a.file);
    const error = str(a.error);
    if (!prompt && !file && !error) {
      ctx.err('Give one of --prompt, --file or --error.');
      return 1;
    }
    const cwd = path.resolve(str(a.cwd) || process.cwd());
    let text = prompt;
    if (file && !prompt) {
      try { text = fs.readFileSync(file, 'utf8').slice(0, 4000); } catch (e) { /* path-only check */ }
    }
    const all = lessons.loadAll({ cwd }).filter(lessons.isActive);
    const matches = evaluate(all, {
      text, file: file || undefined, error: error || undefined, cwd,
      strictProjects: Boolean(file || error), feedback: feedbackCounts(),
    });
    output(ctx, matches.map((m) => ({ id: m.lesson.id, title: m.lesson.title, score: m.score, reasons: m.reasons })),
      matches.length
        ? matches.flatMap((m) => [m.lesson.id + '  score=' + m.score + '  ' + m.lesson.title, '    ' + m.reasons.join(', ')])
        : ['No lessons match (' + all.length + ' active lessons checked).']);
    return 0;
  },
};
