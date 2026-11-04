---
id: git-crlf-line-endings
title: Every line shows as changed in git diff after editing files on Windows
keywords: crlf, lf, line endings, autocrlf, gitattributes, whole file diff, diff noise, line ending
strong: will be replaced by crlf, will be replaced by lf
min_match: 2
errors: will be replaced by crlf, will be replaced by lf
created: 2026-11-04
verified: 2026-11-04
source: generic example
---
**Didn't work:** running `git checkout -- <file>` and re-editing, which brought the same diff back; using `git diff -w` or `--ignore-all-space`, which hid the noise in the terminal but not in the commit; re-saving the file in the editor several times.

**Root cause:** Git stores line endings as they were committed, and the working tree can use another convention. When a file in the index uses LF and the copy on disk uses CRLF (because the editor, a `core.autocrlf = true` setting, or a previous commit made from Windows wrote CRLF), every line differs byte-for-byte. Git's diff then reports the whole file as changed, and a commit can silently convert line endings across the repository. The "LF will be replaced by CRLF" warning is git reporting exactly this conversion.

**Fix:** Put the policy in the repository, not in each machine's config. Add a `.gitattributes` file at the root:

```
* text=auto
```

Git then stores text files with LF and converts them to the platform's native style on checkout. For files that must always be LF in the working tree too, use `eol=lf` on those patterns. Check the local setting with `git config core.autocrlf` and remove an overriding value if it conflicts. Then normalize the existing files once, in a separate commit so the history stays readable:

```bash
git add --renormalize .
git commit -m "Normalize line endings"
```

Requires Git 2.16 or newer. Binary files should be marked `binary` in `.gitattributes` so they are never converted.
