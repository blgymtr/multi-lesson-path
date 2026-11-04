'use strict';
// Glob -> RegExp (SPEC section 5). Case-insensitive, forward-slash paths.
const cache = new Map();

function compile(pattern) {
  if (cache.has(pattern)) return cache.get(pattern);
  let p = String(pattern == null ? '' : pattern).trim().replace(/\\/g, '/');
  let result = null;
  if (p) {
    const hasSlash = p.includes('/');
    const absolute = p.startsWith('/') || /^[a-z]:/i.test(p);
    const basenameOnly = !hasSlash;
    if (hasSlash && !absolute) p = '**/' + p;
    let re = '';
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === '*') {
        if (p[i + 1] === '*') {
          i++;
          if (p[i + 1] === '/') { re += '(?:.*/)?'; i++; } else re += '.*';
        } else re += '[^/]*';
      } else if (c === '?') re += '[^/]';
      else re += c.replace(/[.+^${}()|[\]\\/-]/g, '\\$&');
    }
    try { result = { re: new RegExp('^' + re + '$', 'i'), basenameOnly }; } catch (e) { result = null; }
  }
  cache.set(pattern, result);
  return result;
}

function globToRegExp(pattern) {
  const c = compile(pattern);
  return c ? c.re : null;
}

function isValidGlob(pattern) {
  return compile(pattern) !== null;
}

function matchGlob(pattern, filePath) {
  const c = compile(pattern);
  if (!c || !filePath) return false;
  const norm = String(filePath).replace(/\\/g, '/');
  const target = c.basenameOnly ? norm.slice(norm.lastIndexOf('/') + 1) : norm;
  return c.re.test(target);
}

module.exports = { globToRegExp, isValidGlob, matchGlob };
