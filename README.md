# Simple Coverage

A GitHub Action that does one job: read a coverage report and post the
real number on the pull request. No build step, no language assumptions,
no dependencies to keep patched.

## Why this exists

Every real coverage-reporting action currently in use is locked to one
language — jacoco-report for Java/Android, python-coverage-comment-action
for Python, coverage-badge-go for Go, kover-report for Kotlin. None of
them reads `lcov`, the one coverage format most languages can already
produce (JS/TS, Go, Ruby, Swift, C/C++, Rust, and more).

GitHub itself shipped a native coverage feature in May 2026, but it's
Enterprise Cloud/Team only (not Enterprise Server, no free or open-source
tier), locked to the Cobertura format, and still missing line-by-line
diff annotations. It doesn't reach the population almost every real
competitor action serves.

## Usage

```yaml
name: Coverage
on:
  pull_request:

jobs:
  coverage:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      # ... run your tests however your language does it, producing an
      # lcov report. Most test runners can already do this directly or
      # via a one-line converter.

      - uses: your-org/simple-coverage@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          lcov: coverage/lcov.info
          threshold: 80
```

Push a PR, the action reads the lcov file(s), posts the coverage % as a
comment (creating it once, then updating the same comment on every
re-run instead of piling up duplicates), and fails the job if coverage
is below your threshold — after the comment goes out, so the real number
stays visible even when the run fails.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `lcov` | yes | — | Glob pattern(s) for lcov report file(s), one per line. Multiple files are merged correctly. |
| `threshold` | no | none | Minimum coverage percent required. Fails the run (after commenting) if below. |
| `title` | no | `Coverage Report` | Heading for the posted comment. |
| `comment` | no | `true` | Post/update a PR comment. Set `"false"` to just get the raw numbers as outputs. |

## Outputs

| Output | Description |
|---|---|
| `coverage_percent` | Overall line coverage percent. |
| `lines_hit` | Total lines hit across all merged reports. |
| `lines_found` | Total lines found across all merged reports. |

## What it deliberately doesn't do

- Doesn't run your tests or generate the coverage report — that's your
  job, in whatever language and test runner you use.
- Doesn't read branch or function coverage, only line coverage, in v1.
- Doesn't support Cobertura, JaCoCo XML, or other formats directly —
  only `lcov`. Most tools can already emit or convert to it.

## Design notes

Zero runtime dependencies — Node 20's built-in `fetch` and `fs` only.
Multiple lcov files (e.g. from sharded test runs covering overlapping
files) are merged by taking the real per-line maximum hit count across
all of them, not by summing — summing would double-count and produce a
wrong, inflated-or-broken number.

## Development

```
npm test
```

Runs the full test suite: config validation, lcov parsing and merge
correctness (including the overlapping-shard case), idempotent PR
comment create/update, the full fail-loud validation matrix, and an
end-to-end test against a real local HTTP server standing in for the
GitHub API.

<!-- live dogfood test 2026-07-09T17:59:50.6151584+01:00 -->
