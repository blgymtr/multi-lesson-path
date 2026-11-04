#!/usr/bin/env node
'use strict';
// Fake `claude` CLI for tests. Reads the prompt on stdin, answers with the JSON envelope of `claude -p --output-format json`.
// Behaviour: FAKE_CLAUDE_MODE = ok (default) | trivial | fence | garbage | fail | slow ; FAKE_CLAUDE_LOG = file that receives argv + stdin + env flags.
const fs = require('fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
  if (process.env.FAKE_CLAUDE_LOG) {
    fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv: process.argv.slice(2), stdin: input, mlpDisable: process.env.MLP_DISABLE }) + '\n');
  }
  const lesson = {
    id: 'Missing Dependency Not Installed!', title: 'Tests fail with Cannot find module until the dependency is installed',
    keywords: ['cannot find module', 'modül bulunamadı', 'npm test fails', 'missing dependency', 'eksik paket'],
    strong: [], engines: ['node'], paths: [], errors: ["Cannot find module"],
    body: "**Didn't work:** re-running the tests.\n**Root cause:** the dependency was never installed.\n**Fix:** run the package manager install, then re-run."
  };
  const reply = (text) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: 'fake' }));
  if (mode === 'fail') { process.stderr.write('boom'); process.exit(3); }
  if (mode === 'slow') { setTimeout(() => reply('{"lesson": null}'), 10000); return; }
  if (mode === 'garbage') return reply('I could not decide.');
  if (mode === 'trivial' || input.includes('TRIVIAL-MARKER')) return reply('{"lesson": null}');
  if (mode === 'fence') return reply('Here is the lesson:\n```json\n' + JSON.stringify({ lesson }, null, 2) + '\n```\nHope it helps {not json}.');
  reply(JSON.stringify({ lesson }));
});
