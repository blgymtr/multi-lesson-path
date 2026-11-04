'use strict';
// Scoring + ranking (SPEC section 5).
const path = require('path');
const { fold, tokenize, compileKeyword, matchKeyword } = require('./normalize');
const { matchGlob } = require('./glob');
const { detectEngines } = require('./engines');

function prepare(lesson) {
  if (lesson._c) return lesson._c;
  const c = {
    keywords: (lesson.keywords || []).map(compileKeyword).filter(Boolean),
    strong: (lesson.strong || []).map(compileKeyword).filter(Boolean),
    errors: (lesson.errors || []).map((e) => ({ raw: e, f: fold(e).trim() })).filter((e) => e.f),
    projects: (lesson.projects || []).map((p) => ({ raw: p, f: pathFold(p) })).filter((p) => p.f),
  };
  Object.defineProperty(lesson, '_c', { value: c, enumerable: false, configurable: true });
  return c;
}

function pathFold(p) {
  return fold(String(p || '').replace(/\\/g, '/'));
}

// Engine names the user can mention in a prompt ("unity'de", "godot'ta", "ue5").
const ENGINE_ALIASES = {
  godot: 'godot', gdscript: 'godot', unity: 'unity', unreal: 'unreal', ue5: 'unreal', ue4: 'unreal',
  electron: 'electron', expo: 'expo', python: 'python', rust: 'rust', dotnet: 'dotnet', csharp: 'dotnet',
};

function mentionedEngines(tokens) {
  const out = new Set();
  for (const t of tokens) {
    for (const [alias, eng] of Object.entries(ENGINE_ALIASES)) {
      if (t === alias || (t.startsWith(alias) && t.length - alias.length <= 3)) out.add(eng);
    }
  }
  return [...out];
}

function minMatchOf(lesson) {
  if (lesson.minMatch != null) return lesson.minMatch;
  return (lesson.keywords || []).length < 2 ? 1 : 2;
}

// Does the lesson fire for this text? Returns { fired, strong[], keywords[] }.
// mentioned: engines named in the text; one that the lesson lists counts as one extra keyword.
function matchText(lesson, tokens, set, mentioned) {
  const c = prepare(lesson);
  const strong = c.strong.filter((k) => matchKeyword(k, tokens, set)).map((k) => k.raw);
  const keywords = c.keywords.filter((k) => matchKeyword(k, tokens, set)).map((k) => k.raw);
  const engineHit = (mentioned || []).find((e) => (lesson.engines || []).includes(e) && !keywords.includes(e));
  const n = keywords.length + (engineHit && keywords.length ? 1 : 0);
  return { fired: strong.length > 0 || n >= minMatchOf(lesson), strong, keywords, engineHit: engineHit || null };
}

function matchPaths(lesson, filePath) {
  if (!filePath) return null;
  for (const g of lesson.paths || []) if (matchGlob(g, filePath)) return g;
  return null;
}

function matchErrors(lesson, foldedOutput) {
  if (!foldedOutput) return null;
  for (const e of prepare(lesson).errors) if (foldedOutput.includes(e.f)) return e.raw;
  return null;
}

/**
 * Evaluate lessons against a context.
 * ctx: { text, file, error, cwd, strictProjects, feedback }
 *   feedback: { [lessonId]: { helpful, wrong } }
 * Returns [{ lesson, score, reasons[] }] sorted best first.
 */
function evaluate(lessons, ctx) {
  const c = ctx || {};
  const tokens = c.text ? tokenize(c.text) : [];
  const set = new Set(tokens);
  const mentioned = mentionedEngines(tokens);
  const errFold = c.error ? fold(c.error) : '';
  const projPaths = [c.cwd, c.file].filter(Boolean).map(pathFold);
  const engineDir = c.file ? path.dirname(c.file) : c.cwd;
  let engines = null;
  const out = [];

  for (const lesson of lessons) {
    if (lesson.status !== 'active' || !lesson.id || !lesson.body) continue;
    const reasons = [];
    let score = 0;

    const pathHit = matchPaths(lesson, c.file);
    if (pathHit) { score += 100; reasons.push('path:' + pathHit); }
    const errHit = matchErrors(lesson, errFold);
    if (errHit) { score += 80; reasons.push('error:' + errHit); }
    if (tokens.length) {
      const t = matchText(lesson, tokens, set, mentioned);
      if (t.fired) {
        if (t.strong.length) { score += 60; for (const s of t.strong) reasons.push('strong:' + s); }
        score += 10 * t.keywords.length;
        for (const k of t.keywords) reasons.push('keyword:' + k);
        if (t.engineHit) { score += 10; reasons.push('mentions:' + t.engineHit); }
      }
    }
    if (!reasons.length) continue;

    const pr = prepare(lesson);
    if (pr.projects.length) {
      const matches = pr.projects.some((p) => projPaths.some((pp) => pp.includes(p.f)));
      if (c.strictProjects) {
        if (projPaths.length && !matches) continue;
      }
      if (matches) { score += 5; reasons.push('project'); }
    }

    if (errHit) {
      // A literal error string is specific evidence on its own: an error like "Python was
      // not found" matters in any project, so engine filters do not apply. (Path globs still
      // do: a ViewModel.js in a web app is not an FPS viewmodel.)
    } else if ((lesson.engines || []).length && mentioned.length) {
      // The user named an engine: trust that over the cwd.
      if (!lesson.engines.some((e) => mentioned.includes(e))) continue;
    } else if ((lesson.engines || []).length) {
      if (engines === null) engines = engineDir ? detectEngines(engineDir) : [];
      if (engines.length) {
        if (!lesson.engines.some((e) => engines.includes(e))) continue;
        score += 3;
        reasons.push('engine');
      }
    }

    const fb = (c.feedback && c.feedback[lesson.id]) || null;
    if (fb && fb.wrong) {
      if (fb.wrong >= 3 && fb.wrong > (fb.helpful || 0)) continue;
      score -= 15 * fb.wrong;
      reasons.push('wrong-feedback x' + fb.wrong);
    }
    out.push({ lesson, score, reasons });
  }
  return rank(out);
}

function rank(items) {
  return items.sort((a, b) => b.score - a.score
    || String(b.lesson.verified || '').localeCompare(String(a.lesson.verified || ''))
    || a.lesson.id.localeCompare(b.lesson.id));
}

// SessionStart: "always" lessons whose projects match cwd (no projects = everywhere).
function alwaysMatches(lessons, cwd, feedback, max) {
  const cwdF = cwd ? pathFold(cwd) : '';
  const out = [];
  for (const lesson of lessons) {
    if (!lesson.always || lesson.status !== 'active' || !lesson.id || !lesson.body) continue;
    const pr = prepare(lesson);
    if (pr.projects.length && !pr.projects.some((p) => cwdF.includes(p.f))) continue;
    const fb = feedback && feedback[lesson.id];
    if (fb && fb.wrong >= 3 && fb.wrong > (fb.helpful || 0)) continue;
    out.push({ lesson, score: pr.projects.length ? 5 : 0, reasons: ['always'] });
  }
  return rank(out).slice(0, max || 3);
}

module.exports = { mentionedEngines, evaluate, rank, alwaysMatches, matchText, matchPaths, matchErrors, minMatchOf, pathFold };
