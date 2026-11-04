'use strict';
const fs = require('fs');
const path = require('path');
const paths = require('../paths');
const lessons = require('../lessons');
const { parseArgs } = require('../cliargs');
const { output } = require('../format');

module.exports = {
  summary: 'Create a lesson template in lessons/',
  usage: 'mlp new <id> [--title <text>]',
  run(args, ctx) {
    const a = parseArgs(args, { string: ['title'] });
    const id = a._[0];
    if (!id) { ctx.err('usage: mlp new <id> [--title <text>]'); return 1; }
    if (!lessons.SLUG.test(id)) { ctx.err('id must be a slug: lowercase letters, digits and dashes (got "' + id + '").'); return 1; }
    paths.ensureDirs();
    const file = path.join(paths.lessonsDir(), id + '.md');
    if (fs.existsSync(file)) { ctx.err('Already exists: ' + file); return 1; }
    const l = lessons.emptyLesson(file);
    Object.assign(l, {
      id,
      title: typeof a.title === 'string' && a.title ? a.title : 'TODO one-line title',
      created: lessons.today(),
      verified: lessons.today(),
      body: "**Didn't work:** what was tried and failed.\n**Root cause:** why.\n**Fix:** what actually worked.",
    });
    fs.writeFileSync(file, lessons.serializeLesson(l));
    output(ctx, { id, file }, [file]);
    return 0;
  },
};
