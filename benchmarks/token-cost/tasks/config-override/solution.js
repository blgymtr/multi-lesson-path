'use strict';
// The intended fix: the port must be changed in the file that wins the merge.
const fs = require('fs');
for (const f of ['config.json', 'config.local.json']) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.port = 8080;
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
}
