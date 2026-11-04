'use strict';

function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}

function mean(values) {
  return values.length ? sum(values) / values.length : 0;
}

module.exports = { sum, mean };
