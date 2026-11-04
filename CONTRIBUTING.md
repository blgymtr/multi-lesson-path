# Contributing

Thanks for helping improve multi-lesson-path. This project is small on purpose: zero runtime dependencies, plain Node.js, and files you can read. Please keep changes in that spirit.

## Before you start

- For bugs, open an issue with the command you ran, the output (redacted), your Node.js version and your operating system.
- For features, open an issue first if the change affects the lesson format, the hook output, or the data layout. These are part of the public contract described in the specification at [docs/SPEC.md](docs/SPEC.md).
- Do not include personal information in issues, commits, test fixtures or examples. That includes real names, user names, e-mail addresses, absolute paths from a real machine, and names of private projects. Use placeholders such as `alice`, `~/projects/my-game` or `C:\Users\<you>\`.

## Setup

Requirements: Node.js 18 or newer and Git.

```bash
git clone <repo-url> multi-lesson-path
cd multi-lesson-path
npm run setup-dev    # installs the privacy check as a pre-commit hook
npm test             # runs node --test test/
```

There is nothing to install beyond Node.js. Do not add runtime dependencies. Development tooling needs a strong reason and must not be required to run the program.

## Code rules

- CommonJS modules (`require` / `module.exports`), Node.js 18 or newer, no global state beyond constants.
- All file access goes through the paths in `lib/paths.js`, so tests can point `MLP_HOME` at a temporary directory. Never hard-code the home directory.
- Each CLI command lives in its own module under `lib/commands/` and exports `{ summary, usage, run(args, ctx) }`.
- Hooks must never break the user's action: catch errors, print nothing on failure, exit 0. Respect the time budget in [docs/hooks.md](docs/hooks.md).
- Keep the hook output exactly as specified. Do not add `permissionDecision`, `decision` or `continue` fields.
- Works on Windows, macOS and Linux. Use `path` helpers, forward slashes in generated settings, and `os.homedir()`. Test any change to path handling on Windows.
- Turkish text must keep working: normalization folds `İ`, `I`, `ç ğ ı ö ş ü` and related letters as described in [docs/lesson-format.md](docs/lesson-format.md#matching-rules).

## Tests

- `npm test` must pass before you open a pull request.
- Tests use synthetic fixtures under `test/fixtures/` with placeholder names only. Never copy a real transcript, lesson or settings file into the repository.
- Cover new behavior: a new rule in matching needs a test for the rule and for the case it must not match.
- Hook behavior is tested end to end through a child process with a temporary `MLP_HOME`.

## Lessons and examples

Example lessons in `examples/lessons/` are teaching material. They must:

- describe a real, generic problem and a fix that you have verified,
- use only the front-matter keys from the specification, with a slug `id`,
- have a body with **Didn't work:**, **Root cause:** and **Fix:** sections,
- contain no personal or project-specific details, no internal URLs and no secrets,
- pass `mlp lint` and `mlp privacy-check`.

## Pull requests

1. Fork the repository and create a branch with a descriptive name.
2. Keep each pull request to one logical change. Separate refactors from behavior changes.
3. Update the documentation when behavior changes: `README.md`, the relevant file in `docs/`, and `CHANGELOG.md` under "Unreleased".
4. Make sure `npm test` and `mlp privacy-check` pass.
5. Describe what changed and why, and how you tested it.

Maintainers may ask for changes to match the existing style. Code that adds a dependency, changes the lesson format, or changes hook output will need a discussion first.

## Reporting privacy problems

If you find personal data in the repository, open an issue that names the file and line but does not repeat the data. Maintainers will remove it from the history where practical.

## License

By contributing, you agree that your contributions are licensed under the MIT License in [LICENSE](LICENSE).
