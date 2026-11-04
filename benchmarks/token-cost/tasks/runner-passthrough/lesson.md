---
id: bench-runner-needs-double-dash
title: Flags passed to the project runner are silently ignored without a double dash
keywords: runner, csv, flags ignored, options ignored
min_match: 2
created: 2026-11-04
verified: 2026-11-04
source: benchmark fixture (synthetic)
---
**Didn't work:** `node bin/run.js report --format csv --out out/sales.csv`. It printed the plain table and wrote no file, with no error. Calling `tasks/report.js` directly does nothing because it only exports a function.

**Root cause:** `bin/run.js` has its own `--format` option (log style, only `text` or `json`) and silently drops flags it does not know. Task options are only forwarded after a `--` separator.

**Fix:** `node bin/run.js report -- --format csv --out out/sales.csv`.
