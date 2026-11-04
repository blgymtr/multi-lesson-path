'use strict';
const fs = require('fs');
const path = require('path');
const paths = require('../paths');

module.exports = {
  summary: 'Scan files (default: staged files) for personal data before committing',
  usage: 'mlp privacy-check [paths...]',
  run(args, ctx) {
    const script = path.join(paths.APP_ROOT, 'scripts', 'privacy-check.js');
    if (!fs.existsSync(script)) {
      ctx.err('privacy-check is only available in a source checkout (scripts/privacy-check.js not found).');
      return 1;
    }
    const mod = require(script);
    return mod.run(args, { out: ctx.out, err: ctx.err, cwd: process.cwd() });
  },
};
