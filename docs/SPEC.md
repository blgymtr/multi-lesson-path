# multi-lesson-path — Technical Specification (v0.1)

> Cross-project lesson memory for Claude Code. Lessons are pulled into the
> agent's context **by hooks**, not by the agent remembering to look.

## 1. Goals

1. A lesson learned in one project ("X failed, the root cause was Y, the fix is Z")
   is shown automatically the next time a *related* task starts — in any project.
2. Retrieval is deterministic (Claude Code hooks), cheap (nothing is injected when
   nothing matches) and bounded (hard caps on lessons and characters).
3. Capture is assisted: session transcripts are archived before Claude Code's
   cleanup deletes them, mined for failure → fix episodes, and distilled into
   draft lessons that a human accepts or rejects.
4. Zero runtime dependencies. Node.js >= 18, CommonJS, works on Windows, macOS, Linux.
5. Private by design: all user data lives under `MLP_HOME`, never in this repo.

Non-goals: a vector DB, a cloud service, an MCP server, automatic acceptance of
lessons without review.

## 2. Layout

```
bin/mlp.js                 CLI entry + command dispatcher
lib/paths.js               MLP_HOME and sub-directories
lib/normalize.js           text folding + tokenizing
lib/glob.js                glob -> RegExp
lib/lessons.js             parse / serialize / load lesson files
lib/engines.js             detect project engine/stack from a directory
lib/match.js               scoring + ranking
lib/state.js               per-session de-duplication state
lib/log.js                 hits.jsonl + feedback.jsonl
lib/format.js              build the injected context text
lib/hooks.js               hook entry points (prompt, edit, post-tool, session-start, session-end)
lib/settings.js            install/uninstall merge logic for Claude Code settings.json
lib/transcripts.js         read + normalize Claude Code transcript JSONL
lib/archive.js             condensed gzip archive of transcripts
lib/harvest.js             find failure -> fix episodes, write candidates
lib/distill.js             turn a candidate into a draft lesson via `claude -p`
lib/commands/<name>.js     one module per CLI command: exports { summary, usage, run(args, ctx) }
scripts/privacy-check.js   refuses commits that contain personal data
test/*.test.js             node:test, synthetic fixtures only (test/fixtures/)
docs/, examples/lessons/   documentation and generic example lessons
```

Every module exports plain functions; no globals besides constants. All file IO
goes through paths from `lib/paths.js` so tests can point `MLP_HOME` at a temp dir.

## 3. Data home (`MLP_HOME`)

Default `~/.claude/multi-lesson-path` (env `MLP_HOME` overrides).

```
app/            installed copy of this repo's bin/ lib/ package.json (hooks run from here)
lessons/        accepted lessons, *.md (user-owned)
drafts/         distilled draft lessons waiting for accept/reject
candidates/     harvested episode digests (*.md) + index.json
archive/        condensed transcripts: <project-slug>/<sessionId>.jsonl.gz + index.json
state/          per-session de-dup files (<sessionId>.json), pruned after 7 days
hits.jsonl      one line per injected lesson
feedback.jsonl  one line per `mlp feedback`
config.json     optional overrides (see §9)
disabled        if this file exists, every hook is a no-op
```

Project-local lessons: any `.lessons/*.md` directory found walking up from `cwd`
(max 8 levels, stop at a directory containing `.git`) is also loaded. Their ids are
prefixed `local:` when they collide with a global id.

## 4. Lesson file format

Markdown with a minimal front-matter block. No YAML library: each front-matter line
is `key: value`; list values are comma-separated; `#` starts a comment line.

```markdown
---
id: fps-viewmodel-hands
title: FPS viewmodel hands look twisted or detached
keywords: viewmodel, fps hands, first person arms, wrist, el, kol, bilek
strong: viewmodel
min_match: 2
engines: godot, unity
paths: **/*viewmodel*, **/*arms*.*, **/player/hands/**
errors:
projects:
always: false
created: 2026-01-01
verified: 2026-01-01
source: where this was learned (free text, optional)
---
**Didn't work:** what was tried and failed.
**Root cause:** why.
**Fix:** what actually worked.
```

Fields (only `id`, `title` and a non-empty body are required):

| field | type | meaning |
|---|---|---|
| id | slug `[a-z0-9-]+` | unique id |
| title | text | one line |
| keywords | list | phrases matched against prompt / content text |
| strong | list | phrases that fire the lesson alone |
| min_match | int | distinct keywords needed (default 2; 1 if fewer than 2 keywords) |
| engines | list | `godot, unity, unreal, electron, expo, react-native, node, python, rust, dotnet, web` … |
| paths | list | globs matched against edited file paths |
| errors | list | case-insensitive substrings matched against failing tool output |
| projects | list | substrings of the project path; restricts the lesson to those projects |
| always | bool | inject at SessionStart when `projects` matches the cwd |
| created / verified | date | ISO date |
| status | `active` (default) / `draft` / `retired` | retired lessons never match |

Body sections are free Markdown; the injected text is the body, collapsed to
single spaces and truncated (see §7).

`serializeLesson(lesson)` must round-trip with `parseLessonFile`.

## 5. Normalization and matching

`normalize(text)`:
1. `İ`→`i`, `I`→`i` before lowercasing (avoid Turkish dotless-i surprises), then `toLowerCase()`.
2. Fold `ç→c ğ→g ı→i ö→o ş→s ü→u â→a î→i û→u`, then NFD and drop combining marks.
3. Tokens = runs of `[a-z0-9]`.

Keyword matching (each keyword normalized the same way):
- single word, length >= 4: any token **starts with** it (handles agglutinative suffixes: `bilek` matches `bilekleri`).
- single word, length < 4: exact token match, or the token is the keyword plus one common inflectional suffix (`kol` matches `kollar`, `kolu`; `arm` matches `arms`; `kol` does not match `kolay`).
- `=word`: always exact.
- multi-word phrase: contiguous token sequence, each token compared with the rules above.

Lesson fires for **text** (prompt, file content, command output) when any `strong`
keyword matches, or the number of distinct matched `keywords` >= `min_match`.

Lesson fires for **a file path** when any `paths` glob matches. Glob rules: `**`
any chars incl. `/`, `*` any chars except `/`, `?` one char except `/`; matching is
case-insensitive on a forward-slash path. A pattern without `/` matches the basename;
a pattern with `/` that does not start with `/` or a drive letter is treated as `**/pattern`.

Lesson fires for **error text** when any `errors` substring (normalized) occurs in the
normalized failing output.

Filters applied after firing:
- `status` must be active.
- `engines`: if non-empty and `detectEngines(cwd or file dir)` returned at least one
  engine and the sets do not intersect → drop. Unknown stack → keep.
- `projects`: if non-empty and a concrete project dir is known (edit, post-tool,
  session-start) and none of the substrings occur in the normalized path → drop.
  The prompt hook ignores `projects` unless cwd itself matches one (boost only).

Ranking score: path match 100, error match 80, strong 60, +10 per keyword, +5 if
the project matches, +3 if `engines` intersect, minus 15 per `wrong` feedback
(from feedback.jsonl) and drop if `wrong >= 3 && wrong > helpful`. Ties: newest
`verified` first.

`detectEngines(dir)` walks up to 4 levels: `project.godot`→godot; `Assets/` and
`ProjectSettings/`→unity; `*.uproject`→unreal; `package.json` with an `electron`
dependency→electron, with `expo`→expo, `react-native`→react-native, otherwise node;
`Cargo.toml`→rust; `pyproject.toml`/`requirements.txt`→python; `*.csproj`/`*.sln`→dotnet;
`index.html` alone→web. Results cached per process.

## 6. Hooks

All hook entry points: `node <app>/bin/mlp.js hook <kind>` reading the hook JSON
on stdin. They must **never** fail the user's action: catch everything, exit 0,
print nothing on error (optional debug log at `MLP_HOME/hook-errors.log`), finish
in < 150 ms for 300 lessons. If `MLP_HOME/disabled` exists or `MLP_DISABLE=1`, exit 0 silently.

Output when something matched:
```json
{"hookSpecificOutput":{"hookEventName":"<Event>","additionalContext":"<text>"}}
```
Never emit `permissionDecision`, `decision` or `continue` fields.

| kind | Claude Code event | input used | matching |
|---|---|---|---|
| prompt | UserPromptSubmit | `prompt`, `cwd`, `session_id` | text |
| edit | PreToolUse, matcher `Edit\|Write\|MultiEdit\|NotebookEdit` | `tool_input.file_path` / `notebook_path`, first 4000 chars of `new_string` / `content` / `new_source` | path + text |
| post-tool | PostToolUse, matcher `Bash\|PowerShell` | `tool_input.command`, `tool_response` (stringify, first 6000 chars) | only if the output looks failed (`/error|failed|not found|exception|traceback|cannot|denied|exit code [1-9]|non-zero/i`, or `tool_response.is_error`/`interrupted`); then errors + text |
| session-start | SessionStart | `cwd`, `source` | `always: true` lessons whose `projects` match cwd (max 3) |
| session-end | SessionEnd | `transcript_path`, `session_id` | spawns a **detached** `mlp archive --transcript <path>` child and exits immediately |

De-duplication: `state/<session_id>.json` stores lesson ids already shown in that
session; a lesson is shown at most once per session (a `source: "compact"` or
`"clear"` SessionStart resets the state for that session). Limits: max 3 lessons per
injection, body truncated to 600 chars each, whole context <= 2000 chars.

Context text template:
```
[multi-lesson-path] Lessons from earlier work that match this <task|file|error>. Check them before acting; if one is wrong or outdated, say so and run `mlp feedback <id> wrong`.
- <id>: <title>
  <body…>
```

Each injected lesson appends to `hits.jsonl`:
`{"ts","event","lesson","session","cwd","file","reasons":[…]}`.

## 7. CLI

`mlp <command> [args]`. Global flags: `--home <dir>` (overrides MLP_HOME), `--json`.
Unknown command → usage + exit 1. `mlp help [command]`.

Core (module owner: core):
- `install [--settings <file>] [--no-copy]` — copy `bin/ lib/ package.json` into `MLP_HOME/app`, create dirs, back up settings to `<settings>.bak-mlp-<timestamp>`, merge the five hooks (idempotent: entries are recognized by `multi-lesson-path` in the command; re-install replaces them). Default settings file `~/.claude/settings.json`. Command string: `node "<absolute app path with forward slashes>/bin/mlp.js" hook <kind>`, timeouts 5 s (session-end 10 s).
- `uninstall [--settings <file>]` — remove only our hook entries; keep data.
- `check (--prompt <text> | --file <path> | --error <text>) [--cwd <dir>]` — dry run: prints matches, scores and reasons; no state, no log.
- `list` — id, status, engines, hits (all time / 30 d), last hit.
- `show <id>`, `search <text>` (substring over id/title/keywords/body).
- `new <id> [--title …]` — writes a template into `lessons/`, prints the path.
- `lint` — duplicate ids, missing fields, bad slugs, invalid globs, empty body, unknown keys; exit 1 on errors.
- `stats [--days 30]` — hits per lesson and per event.
- `review [--days 60]` — lessons never hit, not hit in N days, or with wrong feedback; lint warnings.
- `feedback <id> helpful|wrong [--note …]`.
- `retire <id>` — sets `status: retired`.
- `doctor` — node version, MLP_HOME, app copy freshness, hooks present in settings, lint summary, archive size.
- `privacy-check [paths…]` — runs scripts/privacy-check.js.
- `hook <kind>` — §6.

Capture (module owner: capture):
- `archive [--transcript <file>] [--all] [--full] [--roots <dir,…>]` — condensed gzip archive (§8). `--all` archives every transcript under `~/.claude/projects` not yet archived or changed since.
- `harvest [--since <date>] [--project <substr>] [--limit N]` — scan archive (and live transcripts not yet archived) for episodes, write `candidates/<id>.md`, update `candidates/index.json`; idempotent.
- `candidates [--json]` — list candidates with status (new / distilled / rejected).
- `distill [<candidate-id>|--all] [--model haiku] [--limit N] [--dry-run]` — §8.
- `drafts` — list drafts. `accept <draft-id> [--edit]` — lint then move to `lessons/`. `reject <id>` — mark candidate/draft rejected (never re-harvested).

## 8. Capture pipeline

**Transcript reader** (`lib/transcripts.js`). Claude Code stores sessions at
`~/.claude/projects/<slug>/<sessionId>.jsonl` (sub-agents under
`<sessionId>/subagents/*.jsonl`). Each line is JSON; relevant shapes:
- `{"type":"user","message":{"role":"user","content": string | [ {type:"text",text} | {type:"tool_result",tool_use_id,content,is_error} ]},"cwd","sessionId","timestamp","isSidechain"}`
- `{"type":"assistant","message":{"role":"assistant","content":[ {type:"text",text} | {type:"tool_use",id,name,input} | {type:"thinking",…} ]}}`
- many other `type`s (attachment, queue-operation, summary, custom-title, api-request-blob, …) — ignore except `custom-title` (session title) and `summary`.
Lines can be very large; read with a streaming line reader, skip lines > 5 MB, tolerate malformed lines.

`readTranscript(file)` → `{ sessionId, title, cwd, project, start, end, events[] }` where
event = `{ ts, kind: 'user'|'assistant'|'tool_use'|'tool_result', text, tool, input, isError, id }`.
Text from user messages that are system/hook injections (`<system-reminder>`, `<command-…>`,
`<local-command-…>`, hook stdout) is stripped. Tool inputs and results are truncated to 2000 chars.

**Archive** (`lib/archive.js`): `archiveSession(file, {full})` writes
`archive/<project-slug>/<sessionId>.jsonl.gz` containing the condensed events (or the
raw file with `--full`), records `{source, size, mtimeMs, archivedAt, events}` in
`archive/index.json`, skips unchanged sources. Rationale: Claude Code deletes
transcripts after `cleanupPeriodDays` (default 30).

**Episode detection** (`lib/harvest.js`), per session:
- A *failure* is a `tool_result` with `isError`, or Bash/PowerShell output matching the
  failure regex of §6, or a user message matching correction signals
  (TR+EN, normalized: `olmadi, hala, yine, tekrar ayni, yanlis, bozuk, calismiyor, duzelmedi, yamuk, hata veriyor, doesn't work, still, again, wrong, broken, not fixed, same error`).
- Failures on the same target (same file path, same command head, or within 10 events)
  cluster into an episode. An episode is *resolved* when later in the session the same
  target succeeds (a successful tool_result for the same command head/file, or a user
  message with approval signals: `oldu, tamam, calisti, super, harika, works, fixed, perfect, thanks`).
- Keep episodes with >= 2 failures or >= 1 user correction. Score = failures + 3×corrections
  + 2 if resolved. Keep the top `--limit` (default 200) by score.
- Episode id = first 12 hex of sha1(sessionId + first failure event id).

Candidate digest `candidates/<id>.md` (local, private): header (session title, project,
dates, score, files, commands) + a compact timeline of the episode (<= 6000 chars):
user asks, failing attempts (command/file + 300-char error), corrections, the resolving
step and the assistant's explanation around it.

**Distill** (`lib/distill.js`): `distillCandidate(id, {model})` runs
`claude -p --model <model> --output-format json` (spawned, stdin = prompt + digest,
120 s timeout, `--max-turns 1`, no tools) asking for JSON
`{ "lesson": null | { id, title, keywords[], strong[], engines[], paths[], errors[], body } }`.
The prompt requires: generalizable lesson only (null for one-off typos or project trivia),
body with **Didn't work / Root cause / Fix**, keywords in both the conversation's language
and English. Result → `drafts/<id>.md` with `status: draft`, `source: candidate <id>`.
`--dry-run` prints the prompt. Concurrency 3. The `claude` binary path is configurable
(`config.json` → `claudeBin`).

## 9. config.json (optional)

```json
{ "maxLessons": 3, "maxChars": 2000, "bodyChars": 600,
  "transcriptRoots": ["~/.claude/projects"], "claudeBin": "claude",
  "distillModel": "haiku", "failureRegex": null, "extraCorrectionWords": [] }
```

## 10. Privacy

- Nothing under `MLP_HOME` is ever written into the repo. Tests use temp dirs and
  synthetic fixtures with placeholder names (`alice`, `/home/alice/project`).
- `scripts/privacy-check.js` scans the files staged for commit (or given paths) and fails on:
  absolute home paths with a real user name (`C:\Users\<name>\`, `/Users/<name>/`,
  `/home/<name>/` where name is not `alice|bob|user|<user>|runner`), e-mail addresses
  (except `noreply@`/`example.com`), and every line of an optional private deny-list at
  `MLP_HOME/privacy-denylist.txt` (case-insensitive substrings). Installed as the repo's
  `.git/hooks/pre-commit` by `npm run setup-dev`.
- Hooks never send data anywhere. Only `mlp distill` talks to a model, through the
  user's own `claude` CLI, and only when run explicitly.

## 11. Testing

`npm test` = `node --test test/`. Required coverage: normalization (Turkish folding),
glob, keyword rules, ranking, engine/project filters, lesson parse/serialize round trip,
each hook kind end-to-end via a child process with a temp `MLP_HOME` (including
de-dup and the disabled switch), install/uninstall merge on a fixture settings file
(idempotent, preserves unrelated hooks), transcript reading of a synthetic JSONL,
archive idempotence, episode detection on a synthetic failing→fixed session,
distill with a fake `claude` binary (`config.claudeBin` pointing at a node script).
