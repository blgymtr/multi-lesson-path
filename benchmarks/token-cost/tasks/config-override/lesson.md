---
id: bench-config-local-override
title: Changing config.json has no effect because config.local.json silently overrides it
keywords: config.json, config change ignored, setting ignored, no matter what, still shows old value, keeps starting on, override
min_match: 2
created: 2026-11-04
verified: 2026-11-04
source: benchmark fixture (synthetic)
---
**Didn't work:** editing the value in `config.json`, restarting, and searching the code for environment variables or a second place that sets the port. The printed value never changed.

**Root cause:** `src/settings/loader.js` merges `config.json` and then `config.local.json` on top of it. The local file is a leftover set of developer overrides and it wins silently, with no warning when it shadows a key.

**Fix:** Change (or delete) the key in `config.local.json`, then confirm with `node src/index.js --print-config`, which prints the effective settings. Do not trust `config.json` alone.
