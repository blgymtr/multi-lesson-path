'use strict';
const os = require('os');
const path = require('path');
const settings = require('../settings');
const { parseArgs } = require('../cliargs');
const { output } = require('../format');

module.exports = {
  summary: 'Remove the hooks from Claude Code settings.json (data is kept)',
  usage: 'mlp uninstall [--settings <file>]',
  run(args, ctx) {
    const a = parseArgs(args, { string: ['settings'] });
    const file = path.resolve(a.settings || path.join(os.homedir(), '.claude', 'settings.json'));
    const res = settings.uninstall(file);
    output(ctx, { settings: file, changed: res.changed, backup: res.backup }, [
      'settings: ' + file + (res.changed ? ' (hooks removed)' : ' (nothing to remove)'),
      ...(res.backup ? ['backup:   ' + res.backup] : []),
      'Lessons and other data under ' + ctx.home + ' were kept.',
    ]);
    return 0;
  },
};
