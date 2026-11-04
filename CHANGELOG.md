# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-04

Initial release.

### Added

- Lesson files: Markdown with a minimal front-matter block (`id`, `title`, `keywords`,
  `strong`, `min_match`, `engines`, `paths`, `errors`, `projects`, `always`, `created`,
  `verified`, `status`, `source`), parsed and serialized without external dependencies.
- Matching for prompts, edited files and failing command output: keywords with
  Turkish-aware normalization, strong phrases, path globs and error substrings, with
  engine and project filters and ranking.
- Claude Code hooks: `UserPromptSubmit`, `PreToolUse` (edit tools), `PostToolUse`
  (shell tools, only on failed output), `SessionStart` (lessons marked `always`) and
  `SessionEnd` (background archiving). Output is capped at three lessons and 2000
  characters, with at most one injection of each lesson per session.
- CLI `mlp` with `install` and `uninstall` (merge into Claude Code settings with backup),
  `check`, `list`, `show`, `search`, `new`, `lint`, `stats`, `review`, `feedback`,
  `retire`, `doctor`, `privacy-check`, `hook`, `help`.
- Capture pipeline: `archive` (condensed, gzip, before Claude Code's transcript cleanup),
  `harvest` (failure-to-fix episodes), `candidates`, `distill` (drafts through the local
  `claude` CLI, explicit only), `drafts`, `accept`, `reject`.
- Documentation: README, lesson format, hooks, capture, privacy and FAQ.
- Six generic example lessons in `examples/lessons/`.
- Privacy check that refuses personal data such as home-folder paths with real user names,
  e-mail addresses and entries from a private deny-list.
