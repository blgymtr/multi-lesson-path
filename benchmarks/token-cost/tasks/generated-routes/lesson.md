---
id: bench-generated-routes-table
title: Edits to src/routes.generated.js disappear on the next start
keywords: endpoint, add route, new route, routes table
min_match: 2
paths: **/routes.generated.js
created: 2026-11-04
verified: 2026-11-04
source: benchmark fixture (synthetic)
---
**Didn't work:** adding the new route directly to `src/routes.generated.js`. It worked until the next `npm start`, then the route was gone again.

**Root cause:** that file is overwritten on every start by `scripts/gen-routes.js`. The real source of truth is `routes.spec.json`.

**Fix:** add the entry to `routes.spec.json` and run `node scripts/gen-routes.js`. Never edit `src/routes.generated.js` by hand.
