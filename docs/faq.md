# FAQ

**Do I need to run `install` again after updating the repository?**
Yes. Hooks run from the copy in `MLP_HOME/app`, not from the repository. `mlp doctor` reports when the copy is older than the repository's `bin/` and `lib/`. Run `node bin/mlp.js install` from the repository to update it. Your lessons and data are not touched.

**Does it slow Claude Code down?**
Each hook is designed to finish in under 150 ms and to print nothing when no lesson matches. Hook timeouts are set to 5 seconds (10 seconds for session end) so a problem cannot hang a session. The session-end hook returns immediately because archiving runs in a detached process.

**Does it send my code or prompts anywhere?**
No. Hooks do not use the network. The only call to a model is `mlp distill`, which you run yourself and which uses your local `claude` command. See [privacy.md](privacy.md).

**Can the agent ignore a lesson?**
Yes. The injected text asks the agent to check the lessons first and to say so if one is wrong, but nothing forces the agent to follow it. The benefit is that the lesson is in front of the agent at the moment it matters, rather than in a file it has to remember to open.

**Why keyword matching and not embeddings or a search index?**
Retrieval has to be deterministic, fast and free of a model call, so that it can run inside every hook, every edit and every failed command without cost or delay. The matching is explicit: you can read why a lesson fired (`mlp check` prints the reasons). The cost is that you need to write keywords in the words you actually use. Lessons in several languages can list keywords in each language.

**How do I make a lesson fire for something it should match?**
Run `mlp check --prompt "<the text you typed>"` (or `--file` or `--error`). The output shows which keywords and strong phrases matched and which filters dropped a lesson. Add the missing words to `keywords`, or a short distinctive phrase to `strong`.

**A lesson fires too often. What do I do?**
Narrow it. Remove generic keywords, raise `min_match`, add `engines` or `projects`, or move it to `strong` only if the phrase is unique. `mlp stats` shows which lessons fire most.

**A lesson is wrong or outdated.**
Run `mlp feedback <id> wrong --note "why"`. Lessons with repeated `wrong` feedback are ranked down and then stop being injected. Then edit it, or run `mlp retire <id>` to keep the file without using it.

**What happens when two lessons say different things?**
Both can be injected, up to the limit of three per prompt. Ranking favors the more specific match, then the newer `verified` date. Resolve the conflict by editing one lesson, retiring it, or narrowing its triggers.

**Can a project have its own lessons?**
Yes. Put them in a `.lessons/` folder in the project. They are loaded when the working directory is inside the project, and their ids get the prefix `local:` if they collide with a global id. See [lesson-format.md](lesson-format.md#project-local-lessons).

**Why does `mlp archive` run in the background at the end of each session?**
Claude Code deletes transcripts after `cleanupPeriodDays` (30 days by default). Archiving at session end saves the condensed history before that. You can run `mlp archive --all` manually to capture older transcripts that still exist.

**Is the archive a backup of my conversations?**
It is a condensed copy with the most useful parts of each session, not a full backup. Use `--full` to store the raw transcript files. Neither option is encrypted.

**`distill` produced nothing, or an error. Why?**
Check that `claude` runs in the same shell (`claude --version`). If it is not on PATH, set `claudeBin` in `config.json` to its full path. A `null` lesson is normal for one-off problems. Use `mlp distill <id> --dry-run` to see the prompt.

**Does it work on Windows?**
The project targets Windows, macOS and Linux with Node.js 18 or newer. Hook command paths use forward slashes in the settings file, which Claude Code accepts on Windows. Lessons that describe Windows problems are included in `examples/lessons/`.

**Can I use it with other agents besides Claude Code?**
Not as shipped. The hook entry points and settings merge are specific to Claude Code. The lesson format and CLI are plain files and commands, so they can be reused by other tools that can run a command at similar points, but that is not supported.

**Does it need npm packages?**
No. It has no runtime dependencies.

**How do I remove it?**
Run `node bin/mlp.js uninstall` to remove the hooks. Delete `MLP_HOME` to remove the data. See [privacy.md](privacy.md#removing-data).

**How do I contribute a lesson for everyone?**
Lessons in this repository are examples, not a shared database. Write the lesson as a generic example that contains no personal or project-specific details, put it in `examples/lessons/`, run `mlp lint` and the privacy check, and open a pull request. See [CONTRIBUTING.md](../CONTRIBUTING.md).
