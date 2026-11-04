---
id: bench-timestamp-needs-utc
title: Date formatting test passes on CI but fails on a laptop in another time zone
keywords: timestamp, passes on ci, fails on my laptop, fails locally, timezone, utc
min_match: 2
created: 2026-11-04
verified: 2026-11-04
source: benchmark fixture (synthetic)
---
**Didn't work:** re-running the test, clearing caches, and updating the expected string to whatever the laptop printed. The test then failed on CI instead.

**Root cause:** `formatTimestamp` in `src/format.js` uses the local-time getters (`getHours`, `getDate`, ...). Output depends on the machine's time zone, and CI happens to run in UTC. The test data is defined in UTC.

**Fix:** format with the UTC getters (`getUTCFullYear`, `getUTCMonth`, `getUTCDate`, `getUTCHours`, `getUTCMinutes`). Do not change the expected values, and check with `TZ=America/Los_Angeles node test.js`.
