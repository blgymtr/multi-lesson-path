# Capture: archive, harvest, distill, accept

Most useful lessons are already in your past sessions: the failed attempt, the correction, and the step that finally worked. The capture pipeline finds those episodes and proposes lessons from them. A person decides what becomes a lesson.

```
Claude Code sessions (~/.claude/projects, deleted after cleanupPeriodDays)
        |  archive      condensed, gzip, kept under MLP_HOME/archive
        v
MLP_HOME/archive/<project-slug>/<sessionId>.jsonl.gz
        |  harvest      failure -> fix episodes
        v
MLP_HOME/candidates/<id>.md          (digest, status: new)
        |  distill      one call to your own `claude -p`, no tools
        v
MLP_HOME/drafts/<id>.md              (status: draft)
        |  accept --edit   lint, then move
        v                  or reject: never harvested again
MLP_HOME/lessons/<id>.md             (status: active)
```

Nothing in this pipeline runs by itself except `archive`, and `archive` runs only when a session ends (see below).

## 1. Archive

Claude Code keeps session transcripts at `~/.claude/projects/<project-slug>/<sessionId>.jsonl` and deletes them after `cleanupPeriodDays`, which defaults to 30 days. Sub-agent transcripts live in `<sessionId>/subagents/`. The archive keeps what you need for lessons before that cleanup happens.

- The **SessionEnd** hook starts `mlp archive --transcript <path>` as a detached background process and returns immediately, so ending a session is not delayed.
- `mlp archive --all` archives every transcript under the configured `transcriptRoots` that is not yet archived or has changed since it was archived. Run it once after installing to capture existing history, and occasionally afterwards.
- By default each session is stored as condensed events: user messages, assistant text, tool calls with their inputs, and tool results, with long tool inputs and results truncated to 2000 characters. `--full` stores the raw JSONL file instead.
- `MLP_HOME/archive/index.json` records source path, size, modification time, archive time and event count, so unchanged sources are skipped.

System text is removed while reading: `<system-reminder>`, `<command-…>`, `<local-command-…>` blocks and hook output are not kept as user messages. Lines larger than 5 MB are skipped. Malformed lines are ignored.

Archive files are compressed, not encrypted. See [privacy.md](privacy.md).

## 2. Harvest

```bash
mlp harvest --since 2026-10-01 --project my-game --limit 200
```

Harvest reads the archive, plus live transcripts that are not yet archived, and finds episodes:

**A failure** is one of:

- a tool result marked as an error,
- Bash or PowerShell output matching the failure pattern (see [hooks.md](hooks.md#what-looks-failed-means)),
- a user message containing a correction signal. The signals are common correction phrases in English and Turkish, such as "doesn't work", "still", "again", "wrong", "not fixed", and their Turkish equivalents. Add your own with `extraCorrectionWords`.

**Failures cluster into an episode** when they concern the same target: the same file path, the same command head, or events within 10 events of each other.

**An episode is resolved** when, later in the same session, the same target succeeds (a successful tool result for the same command head or file), or the user sends an approval phrase in English or Turkish, such as "works", "fixed", "thanks", or their equivalents.

**Which episodes are kept:** an episode needs at least two failures or at least one user correction. Its score is:

```
score = failures + 3 * corrections + (2 if resolved)
```

The top `--limit` episodes (200 by default) by score are kept. The episode id is the first 12 hex characters of the SHA-1 of the session id and the first failure's event id, so re-running harvest does not create duplicates.

Each episode becomes `MLP_HOME/candidates/<id>.md`, a private digest of at most about 6000 characters:

- a header with session title, project, dates, score, touched files and commands,
- a compact timeline: what the user asked, each failing attempt (command or file, with the first 300 characters of the error), the corrections, the step that resolved it, and the assistant's explanation around that step.

`candidates/index.json` tracks each candidate's status: `new`, `distilled` or `rejected`.

List them:

```bash
mlp candidates
mlp candidates --json
```

## 3. Distill

```bash
mlp distill <candidate-id>          # one candidate
mlp distill --all --limit 20        # up to 20 candidates
mlp distill <candidate-id> --dry-run   # print the prompt, call nothing
```

For each candidate, multi-lesson-path runs your own Claude CLI:

```
claude -p --model haiku --output-format json --max-turns 1
```

The digest and instructions are sent on stdin. No tools are enabled, and the call times out after 120 seconds. Up to three candidates are distilled concurrently. The model is asked for JSON in this shape:

```json
{ "lesson": null | { "id": "...", "title": "...", "keywords": [], "strong": [], "engines": [], "paths": [], "errors": [], "body": "..." } }
```

The instructions require that:

- only generalizable lessons are produced. One-off typos and project trivia return `null`;
- the body has the three parts **Didn't work**, **Root cause** and **Fix**;
- keywords are given both in the conversation's language and in English, so that lessons match whichever language a future prompt uses.

A result with a lesson is written to `MLP_HOME/drafts/<id>.md` with `status: draft` and `source: candidate <candidate-id>`. A `null` result marks the candidate as distilled with no draft.

Settings that affect distillation are in [README.md](../README.md#configuration): `claudeBin` (the command, if `claude` is not on PATH), and `distillModel`.

The model is the only part of the project that talks to a service, and it does so only through the `claude` CLI you already use, only when you run `distill`. Read the digest before distilling if it contains anything you would not want sent to that service. `--dry-run` shows the exact prompt.

## 4. Review: accept or reject

```bash
mlp drafts                       # list drafts waiting for review
mlp show <draft-id>              # read it
mlp accept <draft-id> --edit     # open in your editor, then lint and move
mlp reject <id>                  # mark the candidate or draft as rejected
```

`accept` lints the draft first. If lint reports errors, the draft stays where it is. With `--edit`, your editor opens the file so you can shorten the body, fix keywords, or narrow the `paths` and `engines`. A good lesson is one you could apply to a different project without rewriting it.

`reject` marks the candidate as rejected, so `harvest` never proposes the same episode again. Use it for episodes that are project-specific, already well known, or wrong.

Accepted lessons are regular lessons in `lessons/`. From then on they are matched and injected like any other, and `mlp stats` shows how often they fire.

## Tips

- Start with a small harvest (`--limit 20`) and a single project, and review the results before scaling up.
- A draft with a very generic keyword list (for example `error`, `fix`, `file`) will fire too often. Narrow it before accepting.
- Run `mlp review` after a few weeks. Lessons never hit, or only hit with `wrong` feedback, are good candidates for editing or `mlp retire`.
- Keep `MLP_HOME` out of any synced or shared folder. The archive contains your conversations.
