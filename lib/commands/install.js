'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('../paths');
const settings = require('../settings');
const { parseArgs } = require('../cliargs');
const { output } = require('../format');

function copyApp(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const d of ['bin', 'lib']) {
    fs.rmSync(path.join(dest, d), { recursive: true, force: true });
    fs.cpSync(path.join(src, d), path.join(dest, d), { recursive: true });
  }
  fs.copyFileSync(path.join(src, 'package.json'), path.join(dest, 'package.json'));
  fs.writeFileSync(path.join(dest, '.installed'), new Date().toISOString() + '\n');
}

module.exports = {
  summary: 'Copy the app into MLP_HOME/app and merge the hooks into Claude Code settings.json',
  usage: 'mlp install [--settings <file>] [--no-copy]',
  run(args, ctx) {
    const a = parseArgs(args, { string: ['settings'], boolean: ['no-copy'] });
    const settingsFile = path.resolve(a.settings || path.join(os.homedir(), '.claude', 'settings.json'));
    settings.readSettings(settingsFile); // fail early on unparsable JSON, before touching anything

    paths.ensureDirs();
    const dest = paths.appDir();
    let appDir = paths.APP_ROOT;
    let copied = false;
    if (!a['no-copy']) {
      appDir = dest;
      if (path.resolve(paths.APP_ROOT) !== path.resolve(dest)) { copyApp(paths.APP_ROOT, dest); copied = true; }
    }
    const res = settings.install(settingsFile, appDir);
    output(ctx, { home: paths.home(), app: appDir, copied, settings: settingsFile, changed: res.changed, backup: res.backup }, [
      'home:     ' + paths.home(),
      'app:      ' + appDir + (copied ? ' (copied)' : ''),
      'settings: ' + settingsFile + (res.changed ? ' (hooks written)' : ' (already up to date)'),
      ...(res.backup ? ['backup:   ' + res.backup] : []),
      'Hooks installed: ' + settings.HOOKS.map((h) => h.kind).join(', '),
    ]);
    return 0;
  },
};
