'use strict';
const fs = require('fs');
const path = require('path');
const { resolvePaths } = require('../archive');

const summary = 'List draft lessons waiting for accept / reject';
const usage = 'mlp drafts [--json]';

function listDrafts(home) {
  const dir = resolvePaths(home).drafts;
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch (e) { return []; }
  return files.map((f) => {
    const head = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 3000);
    const g = (k) => { const m = new RegExp('^' + k + ':[ \\t]*(.*)$', 'm').exec(head); return m ? m[1].trim() : ''; };
    return { draftId: f.slice(0, -3), lessonId: g('id'), title: g('title'), file: path.join(dir, f) };
  });
}

async function run(args, ctx) {
  const list = listDrafts(ctx.home);
  if (ctx.json || (args || []).includes('--json')) { ctx.out(JSON.stringify(list)); return 0; }
  if (!list.length) { ctx.out('no drafts - run `mlp distill --all`'); return 0; }
  for (const d of list) ctx.out(d.draftId + '  ' + d.lessonId + '  ' + d.title);
  ctx.out(list.length + ' draft(s). `mlp accept <id> [--edit]` or `mlp reject <id>`.');
  return 0;
}

module.exports = { summary, usage, run, listDrafts };
