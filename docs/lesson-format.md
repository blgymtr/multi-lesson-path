# Lesson format

A lesson is one Markdown file. It starts with a front-matter block that tells multi-lesson-path when to show it, followed by a free-form body that is shown to the agent.

```markdown
---
id: fps-viewmodel-arm-rest-pose
title: First-person arms look twisted or detached because the rig's rest pose and axes do not match the camera
keywords: viewmodel, first person arms, fps hands, arm rig, rest pose, wrist twisted
strong: viewmodel, fps arms
min_match: 2
engines: godot, unity
paths: **/*viewmodel*, **/*arms*.*, **/player/hands/**
errors:
projects:
always: false
created: 2026-11-04
verified: 2026-11-04
source: generic example
---
**Didn't work:** rotating bones by eye until one camera angle looked right.

**Root cause:** the rig's forward axis differs from the engine camera's forward axis.

**Fix:** correct the orientation on a pivot under the camera, then verify at zero pitch and yaw.
```

Only `id`, `title` and a non-empty body are required. Everything else is optional.

## Front matter

The front matter is deliberately minimal. There is no YAML library. Each line is `key: value`. A list value is comma-separated. A line that starts with `#` is a comment. Values are plain text; quotes are not special, so a title containing a colon is fine on one line.

| field | type | meaning |
|---|---|---|
| `id` | slug `[a-z0-9-]+` | Unique identifier. Used in CLI commands and in the injected text. |
| `title` | text | One line, shown to the agent as the heading of the lesson. |
| `keywords` | list | Phrases matched against prompts, file contents and command output. |
| `strong` | list | Phrases that fire the lesson on their own. |
| `min_match` | int | How many distinct `keywords` must match. Default 2, or 1 when the lesson has fewer than two keywords. |
| `engines` | list | Project engines or stacks the lesson applies to, for example `godot, unity, unreal, electron, expo, react-native, node, python, rust, dotnet, web`. |
| `paths` | list | Globs matched against edited file paths. |
| `errors` | list | Case-insensitive substrings matched against failing tool output. |
| `projects` | list | Substrings of the project path. When set, the lesson only applies to those projects. |
| `always` | bool | When `true`, injected at session start if `projects` matches the working directory. |
| `created`, `verified` | date | ISO dates (`YYYY-MM-DD`). `verified` is the last time someone confirmed the fix still works and is used as a tie-breaker. |
| `status` | `active`, `draft` or `retired` | Default `active`. Retired lessons never match. Drafts are not matched. |
| `source` | text | Where the lesson was learned. Free text, optional, not shown to the agent. |

Unknown keys are reported by `mlp lint`.

### Lists

Separate list items with commas: `keywords: python was not found, python command`. A list item cannot contain a comma, so write error substrings and phrases without one. Use short fragments of the real error message: `errors: python was not found, run without arguments to install`.

## Body

The body is free Markdown. multi-lesson-path shows it to the agent with newlines collapsed to single spaces and truncates it to `bodyChars` (600 by default). Put the most useful information first.

The recommended structure is three labelled paragraphs:

- **Didn't work:** what was tried and why it did not solve the problem. This is the part that saves the next agent from repeating it.
- **Root cause:** why the problem happens, in one or two sentences.
- **Fix:** what actually worked, concrete enough to apply directly (a setting, a command, a file to change).

Keep a lesson short. If a lesson needs more than about 600 characters to be useful, split it into two lessons with narrower triggers.

## Matching rules

Text is normalized before matching: `İ` and `I` become `i` before lowercasing, the Turkish letters `ç ğ ı ö ş ü â î û` are folded to ASCII, combining marks are removed, and tokens are runs of `[a-z0-9]`. Keywords are normalized the same way.

### Keywords

- A single word of four or more characters matches a token that **starts with** it. `viewmodel` matches `viewmodels`.
- A single word shorter than four characters matches a token **exactly**.
- A word prefixed with `=` always matches exactly, for example `=fps`.
- A multi-word phrase matches a contiguous sequence of tokens. Each token is compared with the rules above.

### Text

A lesson fires for text (prompt, file content, command output) when any `strong` phrase matches, or when the number of distinct `keywords` that match is at least `min_match`.

### File paths

A lesson fires for an edited file path when any `paths` glob matches. The glob rules:

- `**` matches any characters, including `/`.
- `*` matches any characters except `/`.
- `?` matches one character except `/`.
- Matching is case-insensitive and works on forward-slash paths.
- A pattern without `/` matches the file's basename.
- A pattern with `/` that does not start with `/` or a drive letter is treated as `**/<pattern>`.

### Errors

A lesson fires for failing output when any `errors` substring, normalized, occurs in the normalized output. Use the exact wording of the error message, lowercased. Short, distinctive substrings work best.

## Filters

Applied after a lesson fires:

- `status` must be `active`.
- **engines:** if the lesson lists engines and the engine of the working directory (or of the edited file's directory) was detected, at least one must be in the lesson's list. If no engine was detected, the lesson is kept.
- **projects:** if the lesson lists projects and a concrete project directory is known (edit, post-tool and session-start hooks), one of the substrings must occur in the normalized path. The prompt hook ignores `projects` unless the working directory itself matches, in which case it only boosts the score.

Engine detection is described in [hooks.md](hooks.md#engine-detection).

## Ranking

Each fired lesson gets a score:

| Signal | Points |
|---|---|
| Path match | 100 |
| Error match | 80 |
| Strong phrase match | 60 |
| Each matched keyword | 10 |
| Project matches | 5 |
| Engine intersects | 3 |
| Each `wrong` feedback entry | -15 |

A lesson is dropped when it has at least three `wrong` feedback entries and more `wrong` than `helpful` entries. Ties go to the lesson with the newer `verified` date.

Hooks keep the top `maxLessons` (3 by default), skip lessons already shown in the same session, and truncate to `maxChars`.

## Project-local lessons

A project can keep its own lessons in a `.lessons/` folder. multi-lesson-path looks for `.lessons/*.md` in the working directory and in its parents, walking up at most 8 levels and stopping at the first directory that contains `.git`. Project-local lessons are used with the same rules. If a project-local id collides with a global id, it is loaded with the prefix `local:`.

## Serialization

`mlp` reads and writes lessons with the same parser, so a file that `mlp show` prints can be saved back without changing its meaning. Running `mlp lint` before committing a lesson catches typos in field names, invalid slugs and globs, and empty bodies.
