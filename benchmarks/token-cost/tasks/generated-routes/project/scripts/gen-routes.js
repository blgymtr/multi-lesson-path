'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const spec = JSON.parse(fs.readFileSync(path.join(root, 'routes.spec.json'), 'utf8'));

const entries = spec.map((r) =>
  '  ' + JSON.stringify(r.method + ' ' + r.path) + ': { status: ' + r.status + ', body: ' + JSON.stringify(r.body) + ' },');

const out = "'use strict';\n// routes table (see scripts/gen-routes.js)\nmodule.exports = {\n" + entries.join('\n') + '\n};\n';
fs.writeFileSync(path.join(root, 'src', 'routes.generated.js'), out);
