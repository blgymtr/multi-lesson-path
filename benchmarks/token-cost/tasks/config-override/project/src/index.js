'use strict';
const config = require('./config');

if (process.argv.includes('--print-config')) {
  console.log(JSON.stringify(config, null, 2));
} else {
  console.log(`demo-service would listen on ${config.host}:${config.port} (log level ${config.logLevel})`);
}
