# Build notes

This document describes how the demo bundle is produced, how the project is laid
out, and the conventions the maintainers follow. It is long on purpose; most
sections only matter when you work on that part.

## Layout

- `src/` holds the source files. Every `*.js` file is concatenated in
  alphabetical order.
- `dist/` holds the generated bundle. Never edit it by hand.
- `lib/` holds build helpers.
- `docs/` holds these notes.

## Naming conventions

Source files use lower-case names with no separators. Constants are upper case.
Functions are camel case. Keep each file under 200 lines.

## Coding style

Use two spaces, single quotes, and a trailing newline. Avoid default exports.
Prefer small pure functions. Add a short comment only when the reason for a
decision is not obvious from the code.

## Versioning

The version constant lives in `src/version.js`. Bump it in the same change that
alters the public behaviour of the bundle. The bundle banner records the number
of files, not the version.

## Release checklist

1. Make sure the working tree is clean.
2. Bump the version constant.
3. Run the build and check `dist/bundle.js`.
4. Tag the release and publish.

## Performance notes

The build is a plain concatenation and finishes in a few milliseconds. If it ever
takes longer, check for large files accidentally placed in `src/`.

## Testing notes

There is no test runner. Smoke test the bundle by loading it in a browser or by
evaluating it in a Node REPL.

## Environment notes

The build needs Node 18 or newer. It reads no environment variables and writes
only inside `dist/` and `.stage/`.

## Troubleshooting

### The bundle looks stale

Check the timestamp of `dist/bundle.js` and rebuild.

### Output has unexpected content

Look for stray files in `src/`. Every `*.js` file is included.

### Build stage and interrupted builds

The build enters a short critical section marked by a lock under `.stage/`. A
build that was killed half way (power loss, closed terminal) leaves the marker
behind and every later build then refuses to start. Recover by running the build
once with the unlock flag, which clears the stale marker and builds normally:

    node build.js --unlock

Only do this when you are sure no other build is running.

### Windows notes

Paths in the banner always use forward slashes. Line endings in the bundle follow
the source files.

## Glossary

- Bundle: the single concatenated output file.
- Stage: the critical section guarded by the lock.
