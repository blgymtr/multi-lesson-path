'use strict';
// Build the injected context text (SPEC section 6) + small CLI output helpers.

const collapse = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

function header(label) {
  return '[multi-lesson-path] Lessons from earlier work that match this ' + label
    + '. Check them before acting; if one is wrong or outdated, say so and run `mlp feedback <id> wrong`.';
}

/**
 * items: [{ lesson, ... }] best first. Returns { text, used: [items shown] } or null.
 * Caps: maxLessons, bodyChars per lesson, maxChars overall.
 */
function buildContext(label, items, limits) {
  const lim = Object.assign({ maxLessons: 3, bodyChars: 600, maxChars: 2000 }, limits || {});
  let text = header(label);
  const used = [];
  for (const it of items) {
    if (used.length >= lim.maxLessons) break;
    const l = it.lesson;
    const head = '\n- ' + l.id + ': ' + collapse(l.title) + '\n  ';
    let body = truncate(collapse(l.body), lim.bodyChars);
    const room = lim.maxChars - text.length - head.length;
    if (room < 60) break;
    if (body.length > room) body = truncate(body, room);
    text += head + body;
    used.push(it);
  }
  return used.length ? { text, used } : null;
}

// Emit data: JSON when ctx.json, else the text lines.
function output(ctx, data, lines) {
  if (ctx.json) ctx.out(JSON.stringify(data, null, 2));
  else for (const l of lines) ctx.out(l);
}

// Left-aligned text table. rows: array of arrays of strings; first row is the header.
function table(rows) {
  if (!rows.length) return [];
  const widths = [];
  for (const r of rows) r.forEach((c, i) => { widths[i] = Math.max(widths[i] || 0, String(c).length); });
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? String(c) : String(c).padEnd(widths[i]))).join('  ').trimEnd());
}

module.exports = { collapse, truncate, buildContext, header, output, table };
