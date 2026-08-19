# Continuous integration

`schemaport` is built for CI: findings are exit code 1, and problems with the
invocation itself are exit code 2, so a green build genuinely means "no
findings" rather than "the command was misspelled".

## GitHub Actions

```yaml
name: tools

on:
  pull_request:
  push:
    branches: [main]

jobs:
  schemas:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      # Fail the build on any provider incompatibility.
      - name: Check tool schemas
        run: npx schemaport check tools/ --fail-on error

      # Compile, then fail if the committed output is stale. Compilation is
      # deterministic, so any diff here is a real change.
      - name: Compile tool schemas
        run: |
          npx schemaport compile tools/ --out generated/
          git diff --exit-code generated/

      # Compare this branch's tools against the base branch.
      - name: Diff against the base branch
        if: github.event_name == 'pull_request'
        run: |
          git worktree add ../base ${{ github.event.pull_request.base.sha }}
          npx schemaport diff ../base/tools tools --fail-on breaking
```

## Machine-readable output

`--format json` prints one JSON document to stdout, so a step can post a summary
without scraping text:

```yaml
      - name: Summarise findings
        run: |
          npx schemaport check tools/ --format json --fail-on never > check.json
          jq -r '"\(.summary.errors) errors, \(.summary.warnings) warnings"' check.json >> "$GITHUB_STEP_SUMMARY"
```

`--fail-on never` keeps the step green so the summary is always produced; run the
real gate as its own step.

## Probing in CI

`probe` makes live API calls, so it belongs in a scheduled job rather than on
every pull request — provider schema validation changes without warning, and
that is exactly what `probe` is for catching.

```yaml
  probe:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci

      - name: Probe the provider APIs
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        run: |
          npx schemaport probe tools/ || code=$?
          # 1 = a provider rejected a schema: fail.
          # 3 = we never got a verdict (missing key, network, model): warn only.
          if [ "${code:-0}" = "3" ]; then
            echo "::warning::schemaport probe could not reach a verdict"
            exit 0
          fi
          exit "${code:-0}"
```

Never treat exit 3 as a schema failure: it means the probe could not ask, not
that the provider said no. See [exit-codes.md](exit-codes.md).

## Colour

Colour is emitted only when stdout is a TTY, so CI logs are plain text
automatically. `NO_COLOR=1` disables it everywhere.

## Pinning

Pin `schemaport` in `package.json` and let Dependabot bump it. Provider
compatibility rules ship inside the provider packages, so a bump can legitimately
turn a green check red — that is a finding, not a regression in your code.
