# Privacy

multi-lesson-path is designed so that your conversations and lessons stay on your machine, and so that the repository never contains personal data. This page lists what is stored, where, what leaves the machine, and how to remove it.

## Where data lives

All user data is under one folder, `MLP_HOME`. The default is `~/.claude/multi-lesson-path`. Set the `MLP_HOME` environment variable or pass `--home <dir>` to use another location.

| Path under `MLP_HOME` | Contents | Created by |
|---|---|---|
| `app/` | A copy of the program that the hooks run | `install` |
| `lessons/` | Accepted lessons (you own these files) | you, `new`, `accept` |
| `drafts/` | Lessons proposed by `distill`, awaiting review | `distill` |
| `candidates/` | Episode digests and `index.json` | `harvest` |
| `archive/` | Condensed, compressed session transcripts and `index.json` | `archive` |
| `state/` | Per-session lists of lessons already shown (pruned after 7 days) | hooks |
| `hits.jsonl` | One line per injected lesson: time, event, lesson id, session id, working directory, file, reasons | hooks |
| `feedback.jsonl` | One line per `mlp feedback` | `feedback` |
| `config.json` | Optional settings | you |
| `disabled` | Empty marker file; when present, hooks do nothing | you |
| `privacy-denylist.txt` | Optional: your own list of forbidden substrings for the privacy check | you |

The Claude Code settings file, `~/.claude/settings.json`, contains the five hook entries. `install` backs it up first.

## What is never sent anywhere

- **Hooks send nothing.** They read the JSON that Claude Code gives them, read local lesson files, and write local logs. They do not open network connections.
- **Only `mlp distill` calls a model,** through your local `claude` command. It is never run automatically, and it uses your own Claude Code login and settings. `--dry-run` prints the prompt that would be sent.
- **The repository contains no user data.** Test fixtures are synthetic, use placeholder names such as `alice`, and live in `test/fixtures/`. Example lessons are generic.

## What is in the archive

The archive stores a condensed version of each session: the messages you and the assistant exchanged, tool calls and their (truncated) results, and timestamps. Working directories and project paths are included, because harvest needs them. Treat the archive as a copy of your conversations.

Archive files are compressed with gzip. **Compression is not encryption.** Anyone who can read your user folder can read the archive. If you need encryption, put `MLP_HOME` on an encrypted volume (for example with your operating system's disk encryption), or keep it out of folders that are synchronized to cloud storage.

## Lessons can contain sensitive details

A lesson is a note you keep and the agent reads. Before you accept a draft, check it for:

- project names or internal URLs you do not want to show anywhere,
- customer or colleague names,
- secrets: API keys, tokens, passwords, connection strings,
- file paths that reveal your username.

`mlp accept --edit` opens the draft for this review. `mlp privacy-check` scans lesson files for the patterns listed below.

## Privacy check

`mlp privacy-check [paths…]` runs `scripts/privacy-check.js` over the given files, or over the files staged for commit when no paths are given. It fails on:

- absolute home paths that contain a real user name (`C:\Users\<name>\`, `/Users/<name>/`, `/home/<name>/`), except the placeholder names `alice`, `bob`, `user`, `<user>` and `runner`,
- e-mail addresses, except `noreply@` addresses and the `example.com` domain,
- every line of your optional `MLP_HOME/privacy-denylist.txt`, matched as case-insensitive substrings.

Run `npm run setup-dev` in a clone of the repository to install the check as a pre-commit hook. This protects you when you contribute, and it is part of the project's own rule that personal data never enters the repository.

## Removing data

- To stop everything: `mlp uninstall` removes the hook entries and keeps your data. Or create `MLP_HOME/disabled` to turn hooks off without changing settings.
- To remove the archive only: delete `MLP_HOME/archive/` and `MLP_HOME/candidates/`. Harvest will rebuild from the live transcripts that still exist.
- To remove everything: uninstall, then delete `MLP_HOME`. Claude Code's own transcripts under `~/.claude/projects` are not touched by this project.

## Reporting a privacy problem

If you find personal data in this repository, open an issue or follow the process in [CONTRIBUTING.md](../CONTRIBUTING.md). Do not paste the data itself into the issue; describe the file and line.
