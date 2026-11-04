'use strict';
const routes = require('./routes.generated');

function handle(method, url) {
  return routes[method + ' ' + url] || { status: 404, body: 'not found' };
}

module.exports = { handle };

if (require.main === module) {
  console.log(handle('GET', '/'));
}
