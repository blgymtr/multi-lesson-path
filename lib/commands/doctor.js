'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('../paths');
const lessons = require('../lessons');
const settings = require('../settings');
const { parseArgs } = require('../cliargs');
const { output } = require('../format');

function dirSize(dir) {
  let total = 0;
  let files = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { total += fs.statSync(p).size; files++; } catch (err) { /* vanished */ } }
    }
  };
  walk(dir);
  return { total, files };
}

function sameTree(a, b) {
  // true when every file under a exists with identical content under b
  let same = true;
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(a, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) { walk(rel); continue; }
      try {
        if (!fs.readFileSync(path.join(a, rel)).equals(fs.readFileSync(path.join(b, rel)))) same = false;
      } catch (err) { same = false; }
    }
  };
  walk('.');
  return same;
}

module.exports = {
  summary: 'Health check: node, home, app copy, hooks, lint, archive size',
  usage: 'mlp doctor [--settings <file>]',
  run(args, ctx) {
    const a = parseArgs(args, { string: ['settings'] });
    const checks = [];
    const add = (level, name, detail) => checks.push({ level, name, detail });

    const major = Number(process.versions.node.split('.')[0]);
    add(major >= 18 ? 'ok' : 'fail', 'node', process.version + (major >= 18 ? '' : ' (need >= 18)'));

    const home = paths.home();
    add(fs.existsSync(home) ? 'ok' : 'warn', 'MLP_HOME', home + (fs.existsSync(home) ? '' : ' (missing; run `mlp install`)'));
    if (fs.existsSync(paths.disabledFile())) add('warn', 'disabled', 'the "disabled" file exists: all hooks are no-ops');
    if (process.env.MLP_DISABLE === '1') add('warn', 'disabled', 'MLP_DISABLE=1 is set: all hooks are no-ops');

    const app = paths.appDir();
    if (!fs.existsSync(path.join(app, 'bin', 'mlp.js'))) {
      add('warn', 'app copy', app + ' not installed');
    } else if (path.resolve(app) === path.resolve(paths.APP_ROOT)) {
      add('ok', 'app copy', 'running from the installed copy');
    } else {
      const fresh = sameTree(path.join(paths.APP_ROOT, 'lib'), path.join(app, 'lib'))
        && sameTree(path.join(paths.APP_ROOT, 'bin'), path.join(app, 'bin'));
      add(fresh ? 'ok' : 'warn', 'app copy', fresh ? 'up to date' : 'differs from this checkout; run `mlp install` to refresh');
    }

    const settingsFile = path.resolve(a.settings || path.join(os.homedir(), '.claude', 'settings.json'));
    try {
      const found = settings.findInstalled(settings.readSettings(settingsFile));
      const missing = settings.HOOKS.map((h) => h.kind).filter((k) => !found[k]);
      add(missing.length ? 'warn' : 'ok', 'hooks', missing.length ? 'missing in ' + settingsFile + ': ' + missing.join(', ') : 'all 5 present in ' + settingsFile);
      const dead = Object.entries(found).filter(([, cmd]) => {
        const m = /node "([^"]+)"/.exec(cmd);
        return m && !fs.existsSync(m[1]);
      }).map(([k]) => k);
      if (dead.length) add('fail', 'hook scripts', 'missing script for: ' + dead.join(', '));
    } catch (e) {
      add('warn', 'hooks', e.message);
    }

    const all = lessons.loadAll({ cwd: process.cwd() });
    const lint = lessons.lintAll(all);
    const errs = lint.reduce((n, r) => n + r.errors.length, 0);
    const warns = lint.reduce((n, r) => n + r.warnings.length, 0);
    add(errs ? 'fail' : 'ok', 'lessons', all.length + ' lesson(s), ' + errs + ' lint error(s), ' + warns + ' warning(s)');

    const arch = dirSize(paths.archiveDir());
    add('ok', 'archive', arch.files + ' file(s), ' + (arch.total / 1048576).toFixed(2) + ' MB');

    const failed = checks.some((c) => c.level === 'fail');
    output(ctx, { ok: !failed, checks }, checks.map((c) => '[' + c.level.toUpperCase().padEnd(4) + '] ' + c.name.padEnd(12) + ' ' + c.detail));
    return failed ? 1 : 0;
  },
};
