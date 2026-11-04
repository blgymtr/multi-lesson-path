'use strict';
const fs = require('fs');
const path = require('path');
const stage = require('./lib/stage');

if (!stage.enter(process.argv.slice(2))) {
  console.error('build failed: E_STAGE_LOCK (exit 17)');
  process.exit(17);
}

try {
  const srcDir = path.join(__dirname, 'src');
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort();
  const parts = files.map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8'));
  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'dist', 'bundle.js'), '/* bundle built from ' + files.length + ' files */\n' + parts.join('\n'));
  console.log('built dist/bundle.js from ' + files.length + ' files');
} finally {
  stage.leave();
}
