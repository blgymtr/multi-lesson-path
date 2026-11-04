'use strict';
const lessons = require('../lessons');
const { output } = require('../format');

module.exports = {
  summary: 'Check lesson files (duplicate ids, missing fields, bad globs, unknown keys)',
  usage: 'mlp lint',
  run(args, ctx) {
    const results = lessons.lintAll(lessons.loadAll({ cwd: process.cwd() }));
    let errors = 0;
    let warnings = 0;
    const lines = [];
    const data = [];
    for (const r of results) {
      errors += r.errors.length;
      warnings += r.warnings.length;
      if (r.errors.length || r.warnings.length) {
        data.push({ file: r.lesson.file, id: r.lesson.id, errors: r.errors, warnings: r.warnings });
        lines.push(r.lesson.file);
        for (const e of r.errors) lines.push('  error:   ' + e);
        for (const w of r.warnings) lines.push('  warning: ' + w);
      }
    }
    lines.push(results.length + ' lesson(s), ' + errors + ' error(s), ' + warnings + ' warning(s).');
    output(ctx, { lessons: results.length, errors, warnings, problems: data }, lines);
    return errors ? 1 : 0;
  },
};
