'use strict';
const fs = require('fs');
const { parseArgs } = require('../archive');
const { listDrafts } = require('./drafts');
const { listCandidates, setCandidateStatus } = require('../harvest');

const summary = 'Reject a candidate or draft (it is never harvested again)';
const usage = 'mlp reject <candidate-id|draft-id>';

async function run(args, ctx) {
  let a;
  try { a = parseArgs(args, {}); } catch (e) { ctx.err(e.message); return 1; }
  const id = a.rest[0];
  if (!id) { ctx.err(usage); return 1; }
  const draft = listDrafts(ctx.home).find((x) => x.draftId === id || x.lessonId === id);
  const candId = draft ? draft.draftId : id;
  const isCand = listCandidates(ctx.home).some((c) => c.id === candId);
  if (!draft && !isCand) { ctx.err('no such candidate or draft: ' + id); return 1; }
  if (draft) fs.renameSync(draft.file, draft.file + '.rejected'); // kept on disk, no longer listed
  if (isCand) await setCandidateStatus(ctx.home, candId, { status: 'rejected', rejectedAt: new Date().toISOString() });
  if (ctx.json) ctx.out(JSON.stringify({ rejected: candId })); else ctx.out('rejected: ' + candId);
  return 0;
}

module.exports = { summary, usage, run };
