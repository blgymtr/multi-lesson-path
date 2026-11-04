# Hooks

multi-lesson-path works through five Claude Code hooks. Each hook runs `mlp hook <kind>`, reads the hook's JSON from stdin, and either prints nothing or prints a single JSON object that adds context to the conversation.

## Installed entries

`mlp install` adds these entries to your Claude Code settings file (default `~/.claude/settings.json`). The `command` path is the absolute path of the installed copy, written with forward slashes:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node \"C:/Users/<you>/.claude/multi-lesson-path/app/bin/mlp.js\" hook prompt", "timeout": 5 } ] }
    ],
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit", "hooks": [ { "type": "command", "command": "node \"C:/Users/<you>/.claude/multi-lesson-path/app/bin/mlp.js\" hook edit", "timeout": 5 } ] }
    ],
    "PostToolUse": [
      { "matcher": "Bash|PowerShell", "hooks": [ { "type": "command", "command": "node \"C:/Users/<you>/.claude/multi-lesson-path/app/bin/mlp.js\" hook post-tool", "timeout": 5 } ] }
    ],
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node \"C:/Users/<you>/.claude/multi-lesson-path/app/bin/mlp.js\" hook session-start", "timeout": 5 } ] }
    ],
    "SessionEnd": [
      { "hooks": [ { "type": "command", "command": "node \"C:/Users/<you>/.claude/multi-lesson-path/app/bin/mlp.js\" hook session-end", "timeout": 10 } ] }
    ]
  }
}
```

You do not need to write this by hand. `install` merges it, keeps unrelated hooks in the file, and creates a timestamped backup of the settings file first. Entries are recognized by the text `multi-lesson-path` in their command, so running `install` again replaces them rather than duplicating them. `uninstall` removes only those entries.

On macOS and Linux the paths look the same, for example `~/.claude/multi-lesson-path/app/bin/mlp.js` expanded to an absolute path.

## The five hooks

| Kind | Claude Code event | What it reads | What it matches |
|---|---|---|---|
| `prompt` | `UserPromptSubmit` | `prompt`, `cwd`, `session_id` | The prompt text. |
| `edit` | `PreToolUse`, matcher `Edit\|Write\|MultiEdit\|NotebookEdit` | `tool_input.file_path` (or `notebook_path`), and the first 4000 characters of `new_string`, `content` or `new_source` | The file path, and the new text. |
| `post-tool` | `PostToolUse`, matcher `Bash\|PowerShell` | `tool_input.command`, and `tool_response` stringified to its first 6000 characters | Only when the output looks failed. Then the error text and the command text. |
| `session-start` | `SessionStart` | `cwd`, `source` | Lessons with `always: true` whose `projects` match `cwd`. Up to 3. |
| `session-end` | `SessionEnd` | `transcript_path`, `session_id` | Nothing. It starts a detached `mlp archive --transcript <path>` process and exits. |

### What "looks failed" means

The post-tool hook injects lessons only when the output contains one of these patterns, case-insensitively:

```
error|failed|not found|exception|traceback|cannot|denied|exit code [1-9]|non-zero
```

It also triggers when `tool_response.is_error` or `tool_response.interrupted` is set. If `failureRegex` is set in `config.json`, that pattern replaces the built-in one.

### Session start

The hook input includes a `source` field that says why the session started. When it is `compact` or `clear`, the de-duplication state for that session is reset, so lessons can be shown again.

## Output

When something matched, the hook prints exactly one JSON object on stdout:

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"[multi-lesson-path] Lessons from earlier work that match this task. ...\n- windows-python-store-alias: \"python\" opens the Microsoft Store instead of running Python\n  **Didn't work:** ..."}}
```

`hookEventName` is the event name of the hook (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SessionStart`). The context text starts with `[multi-lesson-path]`, names the kind of task (task, file or error), lists the lessons, and asks the agent to check them and to run `mlp feedback <id> wrong` when a lesson is wrong or outdated.

The hook never prints `permissionDecision`, `decision` or `continue`. It cannot allow, block or change what Claude does. It only adds context.

When nothing matched, the hook prints nothing and exits 0.

## Limits

- At most `maxLessons` lessons per injection (3).
- Each lesson body is cut to `bodyChars` characters (600).
- The whole context is at most `maxChars` characters (2000).
- A lesson is shown at most once per session. The de-duplication state is in `MLP_HOME/state/<session_id>.json`. Files older than 7 days are pruned.
- Each hook must finish in under 150 ms with about 300 lessons. Hook timeouts in settings are 5 seconds (10 seconds for `session-end`).

## Every injection is logged

For each lesson injected, one line is appended to `MLP_HOME/hits.jsonl`:

```json
{"ts":"2026-11-04T10:00:00.000Z","event":"prompt","lesson":"windows-python-store-alias","session":"<session_id>","cwd":"C:/Users/<you>/projects/my-game","file":null,"reasons":["strong: python was not found"]}
```

`mlp stats` and `mlp review` read this file. `mlp feedback` writes `MLP_HOME/feedback.jsonl`.

## Failure behavior

Hooks must never break the action Claude Code is taking. The entry point therefore:

- catches all errors,
- exits with code 0,
- prints nothing on error.

If you need to debug, the hook can append errors to the optional log `MLP_HOME/hook-errors.log`. You can run a hook by hand to see what it does:

```bash
echo '{"prompt":"python was not found","cwd":"C:/Users/<you>/projects/my-game","session_id":"test"}' | node ~/.claude/multi-lesson-path/app/bin/mlp.js hook prompt
```

## Turning it off

- For one shell: `MLP_DISABLE=1`.
- For everything: create an empty file named `disabled` in `MLP_HOME`. Delete it to turn the hooks back on.

With either switch, every hook exits 0 silently before doing any work.

## Engine detection

The engine filter needs to know what kind of project a directory is. `detectEngines(dir)` walks up at most four levels from the working directory and returns the first match it finds:

| Marker | Engine |
|---|---|
| `project.godot` | `godot` |
| `Assets/` and `ProjectSettings/` folders | `unity` |
| `*.uproject` | `unreal` |
| `package.json` with an `electron` dependency | `electron` |
| `package.json` with `expo` | `expo` |
| `package.json` with `react-native` | `react-native` |
| other `package.json` | `node` |
| `Cargo.toml` | `rust` |
| `pyproject.toml` or `requirements.txt` | `python` |
| `*.csproj` or `*.sln` | `dotnet` |
| `index.html` alone | `web` |

If nothing is detected, engine filters keep the lesson. Results are cached for the lifetime of the hook process.
