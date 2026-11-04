'use strict';
// hits.jsonl + feedback.jsonl
const fs = require('fs');
const paths = require('./paths');

function appendLine(file, obj) {
  fs.mkdirSync(paths.home(), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

function readJsonl(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* skip bad line */ }
  }
  return out;
}

function appendHit(entry) {
  appendLine(paths.hitsFile(), Object.assign({ ts: new Date().toISOString() }, entry));
}

function appendFeedback(entry) {
  appendLine(paths.feedbackFile(), Object.assign({ ts: new Date().toISOString() }, entry));
}

const readHits = () => readJsonl(paths.hitsFile());
const readFeedback = () => readJsonl(paths.feedbackFile());

// { [lessonId]: { helpful, wrong } }
function feedbackCounts() {
  const counts = {};
  for (const f of readFeedback()) {
    if (!f || !f.lesson) continue;
    const c = counts[f.lesson] || (counts[f.lesson] = { helpful: 0, wrong: 0 });
    if (f.verdict === 'wrong') c.wrong++;
    else if (f.verdict === 'helpful') c.helpful++;
  }
  return counts;
}

// Group hits by lesson: { [id]: { total, recent, last } } where recent = within `days`.
function hitStats(hits, days) {
  const cutoff = Date.now() - (days || 30) * 86400000;
  const by = {};
  for (const h of hits) {
    if (!h || !h.lesson) continue;
    const s = by[h.lesson] || (by[h.lesson] = { total: 0, recent: 0, last: '' });
    s.total++;
    const t = Date.parse(h.ts);
    if (!Number.isNaN(t) && t >= cutoff) s.recent++;
    if (h.ts && h.ts > s.last) s.last = h.ts;
  }
  return by;
}

module.exports = { appendHit, appendFeedback, readHits, readFeedback, readJsonl, feedbackCounts, hitStats };
