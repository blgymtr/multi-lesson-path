# Token cost benchmark

Does multi-lesson-path actually save tokens and money? This harness measures it with an A/B test on small synthetic projects, each hiding one gotcha that a "previous session" already solved.

## What it measures

For every task, a headless Claude Code agent (`claude -p`) gets a natural user request and works in a fresh copy of the project:

- **off**: hooks installed but disabled (`MLP_DISABLE=1`).
- **on**: hooks enabled. A fresh `MLP_HOME` holds the six generic example lessons plus the lesson of every task, so the matcher has to pick the right one among distractors.

Per run it records success (the task's `verify.js` must exit 0), cost, input/output/cache tokens, turns, duration and how many lessons the hooks injected. Only our hooks are active: `--setting-sources project` and a temp `--settings` file keep personal settings and hooks out.

## Tasks

Each folder in `tasks/` has `project/` (the template), `task.txt` (the user prompt), `verify.js`, `lesson.md` (format of docs/SPEC.md section 4) and `solution.js` (the intended fix, used only by the self-check, never shown to the agent).

| Task | Gotcha |
|---|---|
| config-override | `config.local.json` silently overrides `config.json` |
| build-stage-lock | build fails with `E_STAGE_LOCK` unless run with `--unlock`, documented deep in a long file |
| timestamp-tz | a date test only passes in UTC because the formatter uses local-time getters |
| generated-routes | `src/routes.generated.js` is overwritten on start; edits belong in `routes.spec.json` |
| runner-passthrough | the runner swallows task flags unless they come after `--` |
| control-clamp | control: plain task, no lesson |

## Running

```bash
# 1. Check that tasks are neither pre-solved nor unsolvable; spawns nothing, costs nothing
node benchmarks/token-cost/run.js --dry-run

# 2. The real run (spends money: 6 tasks x 2 conditions x 3 reps = 36 runs, capped at $0.60 each)
node benchmarks/token-cost/run.js --model haiku --reps 3

# 3. Report
node benchmarks/token-cost/report.js benchmarks/token-cost/results/<date>.jsonl
```

Options: `--model`, `--reps`, `--tasks a,b`, `--conditions off,on`, `--max-turns 30`, `--budget 0.60`, `--out <file>`, `--claude <bin>`, `--keep` (keep temp folders), `--dry-run`. Runs are sequential and use your own `claude` login. The time zone is pinned to America/Los_Angeles for every run.

`report.js` writes `RESULTS.md` and `docs/assets/token-cost.svg` and prints a compact table for the README.

## Reading the result

Compare median cost and cost per solved task between off and on, and check "runs with injection": a run where no lesson reached the context cannot show a benefit. The control task shows the overhead when nothing matches. See the limitations in `RESULTS.md`: synthetic tasks, one model, small n, lessons written in advance, and hooks guarantee delivery but not that the model follows the lesson.
