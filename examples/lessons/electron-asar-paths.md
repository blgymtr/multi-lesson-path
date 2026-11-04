---
id: electron-asar-paths
title: Electron app cannot find or run bundled files after packaging because paths break inside app.asar
keywords: asar, app.asar, electron packaged, __dirname, file not found after build, resources path, asarunpack, electron-builder, extraresources, native module
strong: app.asar, asarunpack
min_match: 2
engines: electron
errors: cannot find module, is not a valid win32 application, app.asar
created: 2026-11-04
verified: 2026-11-04
source: generic example
---
**Didn't work:** building `__dirname + '/bin/tool.exe'` and passing it to `child_process.spawn`, which worked in development; copying the binary next to the source files and hoping the packager would include it; reading a native `.node` module through a relative `require`; calling `fs.copyFile` on an asset and expecting the copy to be executable.

**Root cause:** A packaged Electron app keeps its JavaScript and most assets inside `resources/app.asar`, a read-only archive. Node's `fs` module can read files from the archive, which is why reads often work. Executing is different. `child_process` and the operating system cannot run a file that exists only inside the archive, and native `.node` modules must be real files on disk. Paths built from `__dirname` still point inside `app.asar` after packaging, so the same code works in development and fails only in the installed build.

**Fix:** Decide per file where it must live.

- Data that is only read (JSON, images, fonts) can stay inside the archive. Read it with `fs` as usual.
- Executables and native modules must be unpacked. In the electron-builder configuration, add their patterns to `asarUnpack`, for example `"asarUnpack": ["**/node_modules/ffmpeg-static/**"]`. Then resolve them at runtime with the unpacked path:

```js
const path = require('path');
const bin = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
```

- Tools you ship separately can go into `extraResources`. Locate them with `process.resourcesPath` and `path.join`, not with `__dirname`.

Test by running the packaged build, not only `npm start`, after each change to paths or packaging rules.
