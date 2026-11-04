'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalize, tokenize, compileKeyword, matchKeyword } = require('../lib/normalize');
const { matchGlob, globToRegExp, isValidGlob } = require('../lib/glob');
const lessons = require('../lib/lessons');
const { evaluate, alwaysMatches } = require('../lib/match');
const { detectEngines, clearCache } = require('../lib/engines');
const { buildContext } = require('../lib/format');
const { FIXTURES, tmpDir, rmDir } = require('./helpers');

const kw = (k, text) => { const t = tokenize(text); return matchKeyword(compileKeyword(k), t, new Set(t)); };

test('normalize folds Turkish letters and dotted/dotless i', () => {
  assert.equal(normalize('İSTANBUL ŞEHİR ÇIĞ ÖĞÜT'), 'istanbul sehir cig ogut');
  assert.equal(normalize('ışık Âlî Hûd'), 'isik ali hud');
  assert.equal(normalize('Café'), 'cafe');
  assert.deepEqual(tokenize('Kol-Bilek, fps_hands 42'), ['kol', 'bilek', 'fps', 'hands', '42']);
});

test('keyword rules: prefix for >=4, exact for <4, = forces exact, phrases are contiguous', () => {
  assert.ok(kw('viewmodel', 'the viewmodels are twisted'));
  assert.ok(!kw('model', 'the viewmodel'));
  assert.ok(kw('kol', 'sol kol')); // short: exact or exact + inflectional suffix
  assert.ok(kw('kol', 'kollari'));
  assert.ok(!kw('kol', 'kolonya'));
  assert.ok(kw('bilek', 'bileklerim'));
  assert.ok(!kw('=bilek', 'bileklerim'));
  assert.ok(kw('=bilek', 'bilek yamuk'));
  assert.ok(kw('fps hands', 'my FPS handsome rig'));
  assert.ok(!kw('fps hands', 'fps big hands'));
  assert.ok(kw('ISTANBUL', 'İstanbul'));
  assert.ok(!kw('', 'anything'));
});

test('glob: ** / * / ?, basename and relative patterns, Windows paths, case-insensitive', () => {
  assert.ok(matchGlob('**/*viewmodel*', 'C:\\Users\\alice\\proj\\Scripts\\ViewModel.gd'));
  assert.ok(matchGlob('*.GD', '/x/y/a.gd'));
  assert.ok(!matchGlob('*.gd', '/x/y/a.gd.bak'));
  assert.ok(matchGlob('**/player/hands/**', '/g/Player/Hands/rig.tscn'));
  assert.ok(matchGlob('src/*.js', '/repo/src/a.js'));
  assert.ok(!matchGlob('src/*.js', '/repo/src/deep/a.js'));
  assert.ok(matchGlob('src/**/a.js', '/repo/src/deep/er/a.js'));
  assert.ok(matchGlob('src/**/a.js', '/repo/src/a.js'));
  assert.ok(matchGlob('a?.txt', 'C:/Ö/ab.txt'));
  assert.ok(!matchGlob('a?.txt', 'a/.txt'));
  assert.ok(matchGlob('C:/Ünsal/**', 'c:\\ünsal\\x\\y.txt'));
  assert.ok(matchGlob('/abs/dir/*', '/abs/dir/f'));
  assert.ok(!matchGlob('/abs/dir/*', '/other/abs/dir/f'));
  assert.ok(globToRegExp('a.b+c') instanceof RegExp);
  assert.ok(isValidGlob('**/x') && !isValidGlob(''));
});

test('lesson parse/serialize round trip', () => {
  const text = fs.readFileSync(path.join(FIXTURES, 'lessons', 'fps-viewmodel-hands.md'), 'utf8');
  const a = lessons.parseLessonFile(text, 'x.md');
  assert.equal(a.id, 'fps-viewmodel-hands');
  assert.deepEqual(a.keywords.slice(0, 2), ['viewmodel', 'fps hands']);
  assert.deepEqual(a.paths, ['**/*viewmodel*', '**/*arms*.*', '**/player/hands/**']);
  assert.equal(a.minMatch, 2);
  assert.equal(a.always, false);
  assert.match(a.body, /^\*\*Didn't work:\*\*/);
  assert.deepEqual(a.issues, []);
  const b = lessons.parseLessonFile(lessons.serializeLesson(a), 'x.md');
  for (const k of ['id', 'title', 'keywords', 'strong', 'minMatch', 'engines', 'paths', 'errors', 'projects', 'always', 'created', 'verified', 'source', 'status', 'body']) {
    assert.deepEqual(b[k], a[k], k);
  }
  const c = lessons.parseLessonFile(lessons.serializeLesson(Object.assign({}, a, { status: 'retired', always: true, minMatch: null })), 'x.md');
  assert.equal(c.status, 'retired');
  assert.equal(c.always, true);
  assert.equal(c.minMatch, null);
});

test('parse tolerates CRLF, BOM and comments; reports unknown keys', () => {
  const l = lessons.parseLessonFile('\uFEFF---\r\nid: a-b\r\n# comment\r\ntitle: T\r\nbogus: 1\r\n---\r\nBody here\r\n', 'f.md');
  assert.equal(l.id, 'a-b');
  assert.equal(l.body, 'Body here');
  const r = lessons.lintLesson(l);
  assert.ok(r.errors.some((e) => /unknown key "bogus"/.test(e)));
  const none = lessons.parseLessonFile('just text', 'f.md');
  assert.ok(lessons.lintLesson(none).errors.length >= 2);
});

test('lint flags bad slug, empty body, bad min_match, duplicate ids', () => {
  const bad = lessons.parseLessonFile('---\nid: Bad_ID\ntitle: T\nmin_match: x\n---\n', 'f.md');
  const r = lessons.lintLesson(bad);
  assert.ok(r.errors.some((e) => /slug/.test(e)));
  assert.ok(r.errors.some((e) => /empty body/.test(e)));
  assert.ok(r.errors.some((e) => /min_match/.test(e)));
  const a = lessons.parseLessonFile('---\nid: dup\ntitle: T\nkeywords: aaaa\n---\nB', '/a/dup.md');
  const b = lessons.parseLessonFile('---\nid: dup\ntitle: T\nkeywords: aaaa\n---\nB', '/b/dup.md');
  const res = lessons.lintAll([a, b]);
  assert.equal(res[0].errors.length, 0);
  assert.ok(res[1].errors.some((e) => /duplicate id/.test(e)));
});

test('setFrontMatterKey replaces or inserts a key without touching the rest', () => {
  const t = '---\nid: x\nstatus: active\n---\nBody\n';
  assert.equal(lessons.setFrontMatterKey(t, 'status', 'retired'), '---\nid: x\nstatus: retired\n---\nBody\n');
  assert.equal(lessons.setFrontMatterKey('---\nid: x\n---\nB', 'status', 'retired'), '---\nid: x\nstatus: retired\n---\nB');
});

function load(...ids) {
  return ids.map((id) => lessons.parseLessonFile(fs.readFileSync(path.join(FIXTURES, 'lessons', id + '.md'), 'utf8'), id + '.md'));
}

test('match: min_match, strong, path, error and scores', () => {
  const [hands] = load('fps-viewmodel-hands');
  assert.equal(evaluate([hands], { text: 'the wrist looks odd' }).length, 0); // 1 keyword < min_match 2
  const two = evaluate([hands], { text: 'wrist and first person arms are off' });
  assert.equal(two.length, 1);
  assert.equal(two[0].score, 20);
  const strong = evaluate([hands], { text: 'viewmodel broke' });
  assert.equal(strong[0].score, 70); // strong 60 + the same word counted as a keyword (+10)
  const p = evaluate([hands], { file: 'C:\\g\\Player\\Hands\\rig.tscn' });
  assert.equal(p[0].score, 100);
  const [esm] = load('node-esm-require');
  const e = evaluate([esm], { error: 'Error [ERR_REQUIRE_ESM]: Must use import to load ES Module' });
  assert.equal(e[0].score, 80);
  assert.ok(e[0].reasons[0].startsWith('error:'));
});

test('match: Turkish prompt folding fires lesson', () => {
  const [tr] = load('turkish-case');
  assert.equal(evaluate([tr], { text: 'İstanbul ve şehir adı' }).length, 1);
  assert.equal(evaluate([tr], { text: 'sehir adi, istanbul' }).length, 1);
});

test('match: engine filter drops mismatches, unknown stack keeps', () => {
  const [hands] = load('fps-viewmodel-hands');
  const dir = tmpDir('eng');
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '1' } }));
    clearCache();
    assert.deepEqual(detectEngines(dir), ['node']);
    const text = 'wrist and first person arms';
    assert.equal(evaluate([hands], { text, cwd: dir }).length, 0);
    fs.writeFileSync(path.join(dir, 'project.godot'), '');
    clearCache();
    const r = evaluate([hands], { text, cwd: dir });
    assert.equal(r.length, 1);
    assert.equal(r[0].score, 23); // 20 + 3 engine bonus
    const empty = tmpDir('eng2');
    try {
      clearCache();
      assert.equal(evaluate([hands], { text, cwd: empty }).length, 1); // unknown stack -> keep
    } finally { rmDir(empty); }
  } finally { rmDir(dir); clearCache(); }
});

test('detectEngines: unity, electron, expo, rust, python, web', () => {
  const dir = tmpDir('eng3');
  try {
    const mk = (name, files, dirs) => {
      const d = path.join(dir, name);
      fs.mkdirSync(d);
      for (const f of dirs || []) fs.mkdirSync(path.join(d, f));
      for (const [f, c] of Object.entries(files || {})) fs.writeFileSync(path.join(d, f), c);
      return d;
    };
    clearCache();
    assert.deepEqual(detectEngines(mk('u', {}, ['Assets', 'ProjectSettings'])), ['unity']);
    assert.deepEqual(detectEngines(mk('e', { 'package.json': '{"devDependencies":{"electron":"1"}}' })), ['electron']);
    assert.deepEqual(detectEngines(mk('x', { 'package.json': '{"dependencies":{"expo":"1"}}' })), ['expo']);
    assert.deepEqual(detectEngines(mk('r', { 'Cargo.toml': '' })), ['rust']);
    assert.deepEqual(detectEngines(mk('p', { 'pyproject.toml': '' })), ['python']);
    assert.deepEqual(detectEngines(mk('w', { 'index.html': '' })), ['web']);
    assert.deepEqual(detectEngines(mk('n', { 'package.json': '{bad json' })), ['node']);
  } finally { rmDir(dir); clearCache(); }
});

test('match: projects filter is strict for files, boost-only for prompts', () => {
  const l = lessons.parseLessonFile('---\nid: p\ntitle: T\nkeywords: zebra\nprojects: demo-project\n---\nBody', 'p.md');
  assert.equal(evaluate([l], { text: 'zebra', cwd: '/home/alice/other', strictProjects: false }).length, 1);
  assert.equal(evaluate([l], { text: 'zebra', cwd: '/home/alice/other', strictProjects: true }).length, 0);
  const hit = evaluate([l], { text: 'zebra', cwd: '/home/alice/Demo-Project/sub', strictProjects: true });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].score, 15);
});

test('match: wrong feedback lowers score and eventually drops the lesson', () => {
  const [hands] = load('fps-viewmodel-hands');
  const text = 'wrist and first person arms';
  assert.equal(evaluate([hands], { text, feedback: { 'fps-viewmodel-hands': { wrong: 1, helpful: 0 } } })[0].score, 5);
  assert.equal(evaluate([hands], { text, feedback: { 'fps-viewmodel-hands': { wrong: 3, helpful: 0 } } }).length, 0);
  assert.equal(evaluate([hands], { text, feedback: { 'fps-viewmodel-hands': { wrong: 3, helpful: 3 } } }).length, 1);
});

test('match: ranking ties go to the newest verified date; retired never matches', () => {
  const mk = (id, verified, status) => lessons.parseLessonFile(`---\nid: ${id}\ntitle: T\nkeywords: zebra\nverified: ${verified}\nstatus: ${status || 'active'}\n---\nB`, id + '.md');
  const r = evaluate([mk('old', '2025-01-01'), mk('new', '2026-01-01'), mk('gone', '2027-01-01', 'retired')], { text: 'zebra' });
  assert.deepEqual(r.map((x) => x.lesson.id), ['new', 'old']);
});

test('alwaysMatches: needs always + matching project, max 3', () => {
  const mk = (id, projects) => lessons.parseLessonFile(`---\nid: ${id}\ntitle: T\nalways: true\nprojects: ${projects}\n---\nB`, id + '.md');
  const ls = [mk('a', 'demo'), mk('b', 'other'), mk('c', 'demo'), mk('d', 'demo'), mk('e', 'demo')];
  const r = alwaysMatches(ls, '/home/alice/demo/x', {}, 3);
  assert.equal(r.length, 3);
  assert.ok(r.every((m) => m.lesson.id !== 'b'));
});

test('buildContext enforces caps and template', () => {
  const long = 'word '.repeat(400);
  const mk = (id) => ({ lesson: { id, title: 'Title ' + id, body: long } });
  const built = buildContext('task', [mk('a'), mk('b'), mk('c'), mk('d')], {});
  assert.ok(built.used.length <= 3);
  assert.ok(built.text.length <= 2000);
  assert.ok(built.text.startsWith('[multi-lesson-path] Lessons from earlier work that match this task.'));
  assert.match(built.text, /\n- a: Title a\n {2}word/);
  assert.equal(buildContext('task', [], {}), null);
});

test('loadAll cache follows edits, additions and deletions', () => {
  const home = tmpDir('cache');
  const prev = process.env.MLP_HOME;
  try {
    process.env.MLP_HOME = home;
    const dir = path.join(home, 'lessons');
    fs.mkdirSync(dir);
    const f = path.join(dir, 'a.md');
    fs.writeFileSync(f, '---\nid: a\ntitle: First\nkeywords: zebra\n---\nBody one');
    assert.equal(lessons.loadAll()[0].title, 'First');
    assert.ok(fs.existsSync(path.join(home, 'lessons-cache.json')));
    assert.equal(lessons.loadAll()[0].title, 'First'); // served from cache
    fs.writeFileSync(f, '---\nid: a\ntitle: Second title\nkeywords: zebra\n---\nBody one');
    assert.equal(lessons.loadAll()[0].title, 'Second title');
    fs.writeFileSync(path.join(dir, 'b.md'), '---\nid: b\ntitle: B\n---\nB');
    assert.deepEqual(lessons.loadAll().map((l) => l.id), ['a', 'b']);
    fs.unlinkSync(f);
    assert.deepEqual(lessons.loadAll().map((l) => l.id), ['b']);
  } finally {
    if (prev === undefined) delete process.env.MLP_HOME; else process.env.MLP_HOME = prev;
    rmDir(home);
  }
});

test('short keywords match common inflectional suffixes but not unrelated words', () => {
  assert.ok(kw('kol', 'kollar egri duruyor'));
  assert.ok(kw('kol', 'sol kolu kayboldu'));
  assert.ok(kw('el', 'FPS elleri yamuk'));
  assert.ok(kw('arm', 'the arms are rotated'));
  assert.ok(!kw('kol', 'bu cok kolay'));
  assert.ok(!kw('el', 'elma yedim'));
  assert.ok(!kw('=kol', 'kollar'));
});

test('an engine named in the prompt counts as a keyword and overrides cwd detection', () => {
  const { evaluate } = require('../lib/match');
  const lesson = { id: 'u-bones', title: 't', body: 'b', status: 'active', keywords: ['kol', 'fbx', 'kemik'], engines: ['unity'] };
  const g = { id: 'g-only', title: 't', body: 'b', status: 'active', keywords: ['kol', 'kemik'], engines: ['godot'] };
  const r = evaluate([lesson, g], { text: "unity'de karakterin sol kolu kayboldu", cwd: process.cwd() });
  assert.deepStrictEqual(r.map((x) => x.lesson.id), ['u-bones']);
});

test('engine filters do not drop lessons matched by an error string, but still apply to path globs', () => {
  const { evaluate } = require('../lib/match');
  const py = { id: 'py-alias', title: 't', body: 'b', status: 'active', engines: ['python'], errors: ['Python was not found'] };
  const vm = { id: 'vm', title: 't', body: 'b', status: 'active', engines: ['godot'], paths: ['**/*viewmodel*'] };
  // cwd is this repo, which detects as a node project
  assert.deepStrictEqual(evaluate([py], { error: 'Python was not found; run without arguments', cwd: process.cwd() }).map((x) => x.lesson.id), ['py-alias']);
  assert.deepStrictEqual(evaluate([vm], { file: process.cwd() + '/src/viewmodel.js', cwd: process.cwd() }).map((x) => x.lesson.id), []);
});
