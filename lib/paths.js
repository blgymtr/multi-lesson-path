'use strict';
// MLP_HOME and its sub-directories. Everything reads the environment at call
// time so tests (and --home) can redirect it.
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..');

const DEFAULT_CONFIG = {
  maxLessons: 3,
  maxChars: 2000,
  bodyChars: 600,
  transcriptRoots: ['~/.claude/projects'],
  claudeBin: 'claude',
  distillModel: 'haiku',
  failureRegex: null,
  extraCorrectionWords: [],
};

function slashes(p) {
  return String(p).replace(/\\/g, '/');
}

function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function home() {
  if (process.env.MLP_HOME) return path.resolve(process.env.MLP_HOME);
  // Running from an installed copy (<home>/app): the home is its parent.
  if (path.basename(APP_ROOT) === 'app' && fs.existsSync(path.join(APP_ROOT, '.installed'))) {
    return path.dirname(APP_ROOT);
  }
  return path.join(os.homedir(), '.claude', 'multi-lesson-path');
}

const sub = (name) => path.join(home(), name);

function loadConfig() {
  let user = {};
  try {
    const raw = fs.readFileSync(path.join(home(), 'config.json'), 'utf8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) user = parsed;
  } catch (e) { /* optional file */ }
  return Object.assign({}, DEFAULT_CONFIG, user);
}

function ensureDirs() {
  for (const d of [home(), lessonsDir(), draftsDir(), candidatesDir(), archiveDir(), stateDir()]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

const lessonsDir = () => sub('lessons');
const draftsDir = () => sub('drafts');
const candidatesDir = () => sub('candidates');
const archiveDir = () => sub('archive');
const stateDir = () => sub('state');
const appDir = () => sub('app');
const hitsFile = () => sub('hits.jsonl');
const feedbackFile = () => sub('feedback.jsonl');
const configFile = () => sub('config.json');
const disabledFile = () => sub('disabled');
const denylistFile = () => sub('privacy-denylist.txt');
const hookErrorLog = () => sub('hook-errors.log');

module.exports = {
  APP_ROOT, DEFAULT_CONFIG, slashes, expandHome, home, loadConfig, ensureDirs,
  lessonsDir, draftsDir, candidatesDir, archiveDir, stateDir, appDir, hitsFile,
  feedbackFile, configFile, disabledFile, denylistFile, hookErrorLog,
};
