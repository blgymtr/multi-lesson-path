'use strict';
// Hook entry point. Reads the Claude Code hook JSON on stdin; prints JSON only on a match.

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let buf = '';
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer); resolve(buf); } };
    const timer = setTimeout(finish, timeoutMs);
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (d) => { buf += d; });
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
    } catch (e) { finish(); }
  });
}

module.exports = {
  summary: 'Hook entry point used by Claude Code (reads JSON on stdin)',
  usage: 'mlp hook <prompt|edit|post-tool|session-start|session-end>   (hook JSON on stdin)',
  async run(args, ctx) {
    try {
      const hooks = require('../hooks');
      const kind = args[0];
      if (!hooks.KINDS.includes(kind)) return 0;
      const input = hooks.parseInput(await readStdin(3000));
      const out = hooks.handle(kind, input);
      if (out) ctx.out(out);
    } catch (e) { /* hooks never fail the user's action */ }
    return 0;
  },
};
