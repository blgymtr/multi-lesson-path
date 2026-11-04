'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolvePaths, parseArgs } = require('../archive');
const { listDrafts } = require('./drafts');
const { setCandidateStatus } = require('../harvest');

const summary = 'Lint a draft and move it into lessons/';
const usage = 'mlp accept <draft-id> [--edit]';

function lintIssues(text, file) {
  // Uses lib/lessons.js; tolerant of the shape lintLesson returns.
  let L;
  try { L = require('../lessons'); } catch (e) { return { errors: [], warnings: ['lib/lessons.js unavailable, lint skipped'] }; }
  let lesson;
  try { lesson = L.parseLessonFile(text, file); } catch (e) { return { errors: ['cannot parse draft: ' + e.message], warnings: [] }; }
  let res = [];
  try { res = L.lintLesson(lesson); } catch (e) { return { errors: ['lint crashed: ' + e.message], warnings: [] }; }
  const errors = []; const warnings = [];
  const add = (x, defLevel) => {
    if (!x) return;
    if (typeof x === 'string') (defLevel === 'error' ? errors : warnings).push(x);
    else {
      const msg = x.message || x.msg || JSON.stringify(x);
      ((x.level || x.severity || defLevel) === 'error' ? errors : warnings).push(msg);
    }
  };
  if (Array.isArray(res)) res.forEach((x) => add(x, 'error'));
  else if (res && typeof res === 'object') {
    (res.errors || []).forEach((x) => add(x, 'error'));
    (res.warnings || []).forEach((x) => add(x, 'warning'));
  }
  return { errors, warnings, lesson };
}

async function run(args, ctx) {
  let a;
  try { a = parseArgs(args, { bool: ['edit'] }); } catch (e) { ctx.err(e.message); ctx.err(usage); return 1; }
  const id = a.rest[0];
  if (!id) { ctx.err(usage); return 1; }
  const p = resolvePaths(ctx.home);
  const d = listDrafts(ctx.home).find((x) => x.draftId === id || x.lessonId === id);
  if (!d) { ctx.err('no such draft: ' + id + ' (see `mlp drafts`)'); return 1; }
  if (a.flags.edit) {
    const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi');
    spawnSync(editor, [d.file], { stdio: 'inherit', shell: process.platform === 'win32' });
  }
  let text = fs.readFileSync(d.file, 'utf8');
  // Accepted lessons are active: drop the draft status marker.
  text = text.replace(/^status:[ \t]*draft[ \t]*\r?\n/m, '');
  const m = /^id:[ \t]*(.+)$/m.exec(text);
  const lessonId = m ? m[1].trim() : d.draftId;
  const dest = path.join(p.lessons, lessonId + '.md');
  const lint = lintIssues(text, dest);
  lint.warnings.forEach((w) => ctx.err('warning: ' + w));
  if (lint.errors.length) {
    lint.errors.forEach((e) => ctx.err('error: ' + e));
    ctx.err('draft not accepted; fix it (`mlp accept ' + id + ' --edit`) and retry');
    return 1;
  }
  if (!/^[a-z0-9-]+$/.test(lessonId)) { ctx.err('error: invalid lesson id "' + lessonId + '"'); return 1; }
  if (fs.existsSync(dest)) { ctx.err('error: lessons/' + lessonId + '.md already exists'); return 1; }
  fs.mkdirSync(p.lessons, { recursive: true });
  fs.writeFileSync(dest, text);
  fs.unlinkSync(d.file);
  await setCandidateStatus(ctx.home, d.draftId, { status: 'distilled', accepted: true, acceptedAs: lessonId });
  if (ctx.json) ctx.out(JSON.stringify({ accepted: lessonId, file: dest })); else ctx.out('accepted: ' + dest);
  return 0;
}

module.exports = { summary, usage, run };
