'use strict';

function pad(n) {
  return String(n).padStart(2, '0');
}

// Formats epoch milliseconds as "YYYY-MM-DD HH:mm".
function formatTimestamp(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

module.exports = { formatTimestamp };
