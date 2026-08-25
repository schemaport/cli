# Changelog

All notable changes to `schemaport` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `schemaport check --quiet` — text output prints one headline status per
  tool/target (`✗ 3 errors, 2 warnings`, or `✓ Compatible`) plus the trailing
  `Result:` line, and leaves out the individual finding blocks: the message, the
  `Path:` line, the `SchemaPort can compile this:` line and the `Docs:` line.
  Useful when a CI log only needs to say which target is unhappy and how badly.
  Exit codes are unchanged, and `--quiet` has no effect on `--format json`,
  which is already machine-shaped. `--quiet` is accepted by `check` only.

## [0.1.0] - 2026-08-20

### Added

- `schemaport check <path...>` — runs every selected provider's compatibility
  rules over each tool and prints the diagnostics grouped by tool, then by
  target, with the schema path, the explanation and what `compile` will do about
  it. `--fail-on error|warning|never` sets the exit-1 threshold.
- `schemaport compile <path...> --out <dir>` — writes
  `<dir>/<target>/<tool>.json` for each tool and target, plus a deterministic
  `<dir>/manifest.json` recording the source, the output path, every
  transformation and every surviving warning. `--allow-lossy` accepts
  transformations that weaken the schema; without it, such a compilation is
  refused, nothing is written for that tool/target pair, and the run exits 1.
- `schemaport probe <path...>` — compiles each tool and asks the provider API
  whether it accepts the definition. Renders accepted, rejected, skipped and
  error distinctly, surfaces `errorKind`, and prints the provider's own error
  message verbatim on a rejection. A missing API key names the environment
  variable to set and the command to re-run, and exits 3 rather than 1.
- `schemaport diff <old> <new>` — compares two tool sets and groups every change
  as breaking, non-breaking or informational. Never contacts a provider API.
  `--fail-on breaking|any|never` sets the exit-1 threshold.
- `--format json` on all four commands, printing exactly one JSON document to
  stdout with a stable top-level shape.
- `--targets openai,anthropic,gemini,mcp` target selection. `check` and `compile`
  default to all four; `probe` defaults to the three with a hosted API.
- Optional `schemaport.config.json` (or `--config <file>`) supplying `schemas`,
  `targets`, `output` and `allowLossy`. Command-line arguments always override
  it.
- Exit codes: `0` success, `1` findings, `2` usage or input error, `3`
  environment error during `probe`.
- Colour on a TTY only, suppressed by `NO_COLOR` and never applied to JSON.
- An exported `run(argv, io)` entry point returning the exit code, so the CLI can
  be driven in-process by tests and other tools.
- `examples/refund-order` (v1 and v2) and `examples/lossy` example tool sets,
  with a walkthrough in `examples/README.md`.

[0.1.0]: https://github.com/schemaport/cli/releases/tag/v0.1.0
