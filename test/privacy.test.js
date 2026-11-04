'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { ROOT, tmpDir, rmDir } = require('./helpers');
const { scanText, run } = require('../scripts/privacy-check');

// Real-looking values are assembled at runtime so this file itself stays clean.
const winPath = (name) => 'C:' + '\\' + 'Users' + '\\' + name + '\\' + 'proj';
const macPath = (name) => '/' + 'Users' + '/' + name + '/proj';
const linuxPath = (name) => '/' + 'home' + '/' + name + '/proj';

test('flags real home paths and e-mail addresses, allows placeholders', () => {
  assert.equal(scanText('see ' + winPath('alice') + ' and ' + linuxPath('bob') + ' and ' + macPath('runner'), []).length, 0);
  assert.equal(scanText('C:/Users/<user>/x and /home/<name>/y and %USERPROFILE%', []).length, 0);
  assert.equal(scanText('mail alice@example.com, noreply@anthropic.com, dev@sub.example.com', []).length, 0);
  assert.equal(scanText(winPath('Carol'), []).length, 1);
  assert.equal(scanText(winPath('Carol').replace(/\\/g, '\\\\'), []).length, 1); // JSON-escaped
  assert.equal(scanText('C:/' + 'Users/' + 'Dave/x', []).length, 1);
  assert.equal(scanText(macPath('erin'), []).length, 1);
  assert.equal(scanText(linuxPath('frank'), []).length, 1);
  assert.equal(scanText('write to carol' + '@' + 'corp.io please', []).length, 1);
  assert.equal(scanText(winPath('Öner'), []).length, 1);
  assert.equal(scanText('package react@18.3.1 and @types/node', []).length, 0);
});

test('deny-list entries are matched case-insensitively and not echoed', () => {
  const f = scanText('Some SECRETWORD here', ['secretword']);
  assert.equal(f.length, 1);
  assert.equal(f[0].text, '(hidden)');
  assert.equal(scanText('nothing', ['secretword']).length, 0);
});

test('run() scans explicit paths and returns exit codes', () => {
  const dir = tmpDir('priv');
  try {
    fs.writeFileSync(path.join(dir, 'clean.md'), 'hello /home/alice/project');
    fs.writeFileSync(path.join(dir, 'dirty.md'), 'x\n' + winPath('Grace') + '\n');
    fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 0x43, 0x3a]));
    const errs = [];
    const outs = [];
    const io = { out: (l) => outs.push(l), err: (l) => errs.push(l), cwd: dir };
    assert.equal(run(['clean.md', 'bin.dat'], io), 0);
    assert.equal(run(['dirty.md'], io), 1);
    assert.ok(errs.some((l) => l.includes('dirty.md:2')));
    assert.equal(run(['missing.md'], io), 2);
  } finally { rmDir(dir); }
});

test('staged mode and pre-commit hook installed by setup-dev block a bad commit', () => {
  const repo = tmpDir('repo');
  try {
    const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git('init', '-q');
    git('config', 'user.email', 'alice@example.com');
    git('config', 'user.name', 'alice');
    fs.mkdirSync(path.join(repo, 'scripts'));
    fs.copyFileSync(path.join(ROOT, 'scripts', 'privacy-check.js'), path.join(repo, 'scripts', 'privacy-check.js'));
    fs.copyFileSync(path.join(ROOT, 'scripts', 'setup-dev.js'), path.join(repo, 'scripts', 'setup-dev.js'));
    const sd = spawnSync(process.execPath, [path.join(repo, 'scripts', 'setup-dev.js')], { encoding: 'utf8' });
    assert.equal(sd.status, 0, sd.stderr);
    assert.ok(fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit')));

    fs.writeFileSync(path.join(repo, 'ok.txt'), 'fine /home/alice/x');
    git('add', 'ok.txt');
    const ok = spawnSync(process.execPath, [path.join(repo, 'scripts', 'privacy-check.js')], { cwd: repo, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);

    fs.writeFileSync(path.join(repo, 'bad.txt'), macPath('henry'));
    git('add', 'bad.txt');
    const bad = spawnSync(process.execPath, [path.join(repo, 'scripts', 'privacy-check.js')], { cwd: repo, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /bad\.txt:1/);
    // staged content, not the working tree, is what counts
    fs.writeFileSync(path.join(repo, 'bad.txt'), 'cleaned');
    assert.equal(spawnSync(process.execPath, [path.join(repo, 'scripts', 'privacy-check.js')], { cwd: repo, encoding: 'utf8' }).status, 1);
  } finally { rmDir(repo); }
});
