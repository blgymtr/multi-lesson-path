#!/usr/bin/env node
'use strict';
// CLI entry + command dispatcher. Commands live in lib/commands/<name>.js and export
// { summary, usage, run(args, ctx) }; ctx = { home, json, out(line), err(line) }.
const fs = require('fs');
const path = require('path');

const CMD_DIR = path.join(__dirname, '..', 'lib', 'commands');

function listCommands() {
  try {
    return fs.readdirSync(CMD_DIR).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
  } catch (e) { return []; }
}

function loadCommand(name) {
  if (!/^[a-z][a-z-]*$/.test(name)) return null;
  const file = path.join(CMD_DIR, name + '.js');
  if (!fs.existsSync(file)) return null;
  return require(file);
}

function usageText(ctx) {
  const lines = ['multi-lesson-path (mlp): cross-project lesson memory for Claude Code', '',
    'Usage: mlp [--home <dir>] [--json] <command> [args]', '', 'Commands:'];
  const names = listCommands();
  const width = Math.max(8, ...names.map((n) => n.length));
  for (const n of names) {
    let summary = '';
    try { summary = (loadCommand(n) || {}).summary || ''; } catch (e) { summary = '(failed to load)'; }
    lines.push('  ' + n.padEnd(width) + '  ' + summary);
  }
  lines.push('', 'Run `mlp help <command>` for details.');
  for (const l of lines) ctx.out(l);
}

function helpFor(name, ctx) {
  const mod = loadCommand(name);
  if (!mod) { ctx.err('Unknown command: ' + name); usageText(ctx); return 1; }
  ctx.out(mod.usage || ('mlp ' + name));
  if (mod.summary) { ctx.out(''); ctx.out(mod.summary); }
  return 0;
}

async function main(argv) {
  let home = null;
  let json = false;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--home') { home = argv[++i]; continue; }
    if (a.startsWith('--home=')) { home = a.slice(7); continue; }
    if (a === '--json') { json = true; continue; }
    rest.push(a);
  }
  if (home) process.env.MLP_HOME = path.resolve(home);
  const paths = require('../lib/paths');
  const ctx = {
    home: paths.home(),
    json,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  };
  const cmd = rest[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    if (rest[1]) return helpFor(rest[1], ctx);
    usageText(ctx);
    return 0;
  }
  if (cmd === '--version' || cmd === '-v') {
    ctx.out(require('../package.json').version);
    return 0;
  }
  const mod = loadCommand(cmd);
  if (!mod) {
    ctx.err('Unknown command: ' + cmd);
    usageText(ctx);
    return 1;
  }
  if (cmd !== 'hook' && (rest.includes('--help') || rest.includes('-h'))) return helpFor(cmd, ctx);
  try {
    const code = await mod.run(rest.slice(1), ctx);
    return typeof code === 'number' ? code : 0;
  } catch (e) {
    if (cmd === 'hook') return 0;
    ctx.err('mlp ' + cmd + ': ' + (process.env.MLP_DEBUG ? e.stack : e.message));
    return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => { console.error(e && e.message); process.exitCode = process.argv[2] === 'hook' ? 0 : 1; }
);
