'use strict';
// Detect project engine / stack from a directory (SPEC section 5). Cached per process.
const fs = require('fs');
const path = require('path');

const cache = new Map();

function readPackageEngine(file) {
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies, pkg.peerDependencies);
    if (deps.electron) return 'electron';
    if (deps.expo) return 'expo';
    if (deps['react-native']) return 'react-native';
  } catch (e) { /* unreadable package.json */ }
  return 'node';
}

function detectLevel(dir) {
  const found = new Set();
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return found; }
  const lower = new Set(names.map((n) => n.toLowerCase()));
  if (lower.has('project.godot')) found.add('godot');
  if (lower.has('assets') && lower.has('projectsettings')) found.add('unity');
  if (names.some((n) => n.toLowerCase().endsWith('.uproject'))) found.add('unreal');
  if (lower.has('package.json')) {
    found.add(readPackageEngine(path.join(dir, names.find((n) => n.toLowerCase() === 'package.json'))));
  }
  if (lower.has('cargo.toml')) found.add('rust');
  if (lower.has('pyproject.toml') || lower.has('requirements.txt')) found.add('python');
  if (names.some((n) => /\.(csproj|sln)$/i.test(n))) found.add('dotnet');
  if (!found.size && lower.has('index.html')) found.add('web');
  return found;
}

// Walks up to 4 levels (stopping after a directory that contains .git).
function detectEngines(dir) {
  if (!dir) return [];
  const start = path.resolve(dir);
  if (cache.has(start)) return cache.get(start).slice();
  const all = new Set();
  let cur = start;
  for (let i = 0; i < 4; i++) {
    for (const e of detectLevel(cur)) all.add(e);
    if (fs.existsSync(path.join(cur, '.git'))) break;
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  const res = Array.from(all);
  cache.set(start, res);
  return res.slice();
}

function clearCache() { cache.clear(); }

module.exports = { detectEngines, clearCache };
