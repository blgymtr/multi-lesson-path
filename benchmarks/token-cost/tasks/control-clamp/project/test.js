'use strict';
const assert = require('assert');
const { sum, mean } = require('./src/mathutil');

assert.strictEqual(sum([1, 2, 3]), 6);
assert.strictEqual(mean([2, 4]), 3);
console.log('all tests passed');
