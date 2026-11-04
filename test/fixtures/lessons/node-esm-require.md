---
id: node-esm-require
title: require() of an ES module fails
keywords: require esm, es module, cannot use import
engines: node, electron
errors: ERR_REQUIRE_ESM, Must use import to load ES Module
created: 2026-02-01
verified: 2026-02-10
---
**Didn't work:** renaming the file to .cjs.
**Root cause:** the dependency is ESM only.
**Fix:** use dynamic import() or pin the older major version.
