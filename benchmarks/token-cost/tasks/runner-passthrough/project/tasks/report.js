'use strict';
const fs = require('fs');
const path = require('path');

function parse(args) {
  const o = { format: 'table', out: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--format') o.format = args[++i];
    else if (args[i] === '--out') o.out = args[++i];
  }
  return o;
}

function run(args, ctx) {
  const o = parse(args);
  const rows = JSON.parse(fs.readFileSync(path.join(ctx.root, 'data', 'sales.json'), 'utf8'))
    .map((r) => ({ region: r.region, units: r.units, revenue: r.units * r.price }));
  let text;
  if (o.format === 'csv') {
    text = ['region,units,revenue'].concat(rows.map((r) => [r.region, r.units, r.revenue].join(','))).join('\n') + '\n';
  } else {
    text = rows.map((r) => r.region.padEnd(8) + String(r.units).padStart(6) + String(r.revenue).padStart(10)).join('\n') + '\n';
  }
  if (o.out) {
    fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    fs.writeFileSync(o.out, text);
    ctx.log('wrote ' + o.out);
  } else {
    process.stdout.write(text);
  }
}

module.exports = { run };
