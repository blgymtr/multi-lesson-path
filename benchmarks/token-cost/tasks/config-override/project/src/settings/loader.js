'use strict';
const fs = require('fs');
const path = require('path');

// Layers are applied in order; later layers win.
const LAYERS = ['config.json', 'config.local.json'];

function readLayer(root, name) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function load(root) {
  return LAYERS.reduce((acc, name) => Object.assign(acc, readLayer(root, name)), {});
}

module.exports = { load };
