---
id: windows-python-store-alias
title: "python" opens the Microsoft Store instead of running Python
keywords: python was not found, python command, microsoft store, app execution alias, python3, py launcher, windows python
strong: python was not found, app execution alias
min_match: 2
engines: python
errors: python was not found, run without arguments to install
created: 2026-11-04
verified: 2026-11-04
source: generic example
---
**Didn't work:** reinstalling Python from python.org with the default options, then running the same command again; restarting the terminal several times; checking that `python --version` works in one shell but not another.

**Root cause:** Windows 10 and 11 ship App Execution Alias stubs named `python.exe` and `python3.exe` in `%LOCALAPPDATA%\Microsoft\WindowsApps`. That folder is usually early in PATH, so the stub is found before the real interpreter. The stub does not run Python. It prints "Python was not found; run without arguments to install from the Microsoft Store" and exits with a non-zero code.

**Fix:** Open Settings, go to Apps, then Advanced app settings, then App execution aliases, and turn off the `python.exe` and `python3.exe` entries. Open a new terminal and run `python --version` again. If the real Python is installed and still not found, add its folder (the one that contains `python.exe`) to the user PATH ahead of WindowsApps. The Python launcher is an alternative that avoids PATH edits: `py -3 --version` runs the newest installed Python 3. Use `py -3 -m pip install ...` for packages.
