---
id: powershell-npm-execution-policy
title: npm or npx fails with "running scripts is disabled on this system" in PowerShell
keywords: npm, npx, execution policy, npm.ps1, running scripts is disabled, powershell script, set-executionpolicy
strong: npm.ps1 cannot be loaded, running scripts is disabled
min_match: 2
engines: node, electron, expo, react-native, web
errors: running scripts is disabled on this system, npm.ps1 cannot be loaded
created: 2026-11-04
verified: 2026-11-04
source: generic example
---
**Didn't work:** reinstalling Node.js; running the terminal as administrator and retrying; deleting and recreating `node_modules` and the lock file; running `npm install` again and again because the error looked like a broken package.

**Root cause:** On Windows, the npm installer also writes `npm.ps1`, `npx.ps1` and similar PowerShell shims next to `npm.cmd`. When you type `npm` in PowerShell, PowerShell prefers the `.ps1` file. The default execution policy on Windows client editions is `Restricted`, which refuses to run any `.ps1` script, so the command fails before npm starts. The same policy blocks other tools that ship PowerShell shims, such as global CLIs installed by npm.

**Fix:** Allow locally written scripts for your user account. This does not need administrator rights:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Open a new PowerShell window and run `npm --version` again. For a single session only, `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` works without changing the saved setting. Another option is to call the command-prompt shim directly, for example `npm.cmd install`, which is not affected by the policy. Check the current value with `Get-ExecutionPolicy -List`.
