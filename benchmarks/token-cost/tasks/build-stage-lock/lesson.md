---
id: bench-build-stage-lock
title: Build fails with E_STAGE_LOCK after an interrupted build
keywords: build, dist, bundle, unlock, stale lock
min_match: 2
errors: E_STAGE_LOCK
created: 2026-11-04
verified: 2026-11-04
source: benchmark fixture (synthetic)
---
**Didn't work:** running the build again and again, and reading the error as a permissions problem. The message is only `E_STAGE_LOCK (exit 17)` and never says what to do.

**Root cause:** an earlier build was killed and left a marker file in `.stage/`; every later build refuses to enter the stage while it exists. The way to clear it is documented only deep inside `docs/BUILD.md`.

**Fix:** run the build once with the unlock flag: `node build.js --unlock`. It clears the stale marker and builds normally. Only do this when no other build is running.
