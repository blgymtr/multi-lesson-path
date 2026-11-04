'use strict';
// Tiny argv parser. spec: { string: [names that take a value], boolean: [flag names] }
// Returns { _: positionals, <flag>: value }. Unknown --flags take a value if one follows.
function parseArgs(argv, spec) {
  const s = spec || {};
  const strings = new Set(s.string || []);
  const bools = new Set(s.boolean || []);
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--') || a.length < 3) { out._.push(a); continue; }
    let name = a.slice(2);
    let val;
    const eq = name.indexOf('=');
    if (eq >= 0) { val = name.slice(eq + 1); name = name.slice(0, eq); }
    if (bools.has(name)) { out[name] = val === undefined ? true : !/^(false|0|no)$/i.test(val); continue; }
    if (val === undefined) {
      const next = argv[i + 1];
      if (strings.has(name) || (next !== undefined && !next.startsWith('--'))) val = argv[++i];
      else val = true;
    }
    out[name] = val;
  }
  return out;
}

module.exports = { parseArgs };
