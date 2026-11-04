'use strict';
const assert = require('assert');
const { formatTimestamp } = require('./src/format');

// 2024-06-01T14:30:00Z
assert.strictEqual(formatTimestamp(1717252200000), '2024-06-01 14:30');
// 2023-12-31T23:59:00Z
assert.strictEqual(formatTimestamp(1704067140000), '2023-12-31 23:59');

console.log('all tests passed');
