'use strict';
const path = require('path');
const { load } = require('./settings/loader');

module.exports = load(path.join(__dirname, '..'));
