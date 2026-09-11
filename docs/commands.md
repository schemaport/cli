# Commands and flags

```
schemaport check   <path...>  [--targets <ids>] [--format text|json] [--fail-on error|warning|never] [--quiet|--matrix] [--config <file>]
schemaport compile <path...>  --out <dir> [--targets <ids>] [--format text|json] [--allow-lossy] [--config <file>]
schemaport probe   <path...>  [--targets <ids>] [--format text|json] [--model <id>] [--allow-lossy] [--config <file>]
schemaport diff    <old> <new> [--targets <ids>] [--format text|json] [--fail-on breaking|any|never]
schemaport --help | --version
```

`--help` (or `-h`) works on its own and after a command: `schemaport compile
--help` prints the compile reference.

## Shared behaviour

### Paths

Every command accepts a `.json` file or a directory. Directories are read
recursively, skipping `node_modules`, `dist`, `coverage` and dot-directories. A
file may contain one tool object, an array of tool objects, or
`{ "tools": [ ... ] }`.

Tool names must be unique across everything one command loads. That is why the
example project keeps `v1` and `v2` in separate directories: they both define
`refund_order`, so loading them together is a duplicate-name error.

`<path...>` may be omitted when the config file sets `schemas`. `diff` always
takes exactly two paths.

Any load error — a path that does not exist, invalid JSON, a tool that is not a
valid canonical tool, a duplicate name — stops the command and exits 2. Nothing
is checked, compiled or probed on a partially valid input set.

### `--targets <ids>`

A comma-separated list of `openai`, `anthropic`, `gemini`, `mcp`, or the
shorthand `all`.

- `check`, `compile`: all four by default.
- `probe`: `openai,anthropic,gemini` by default. MCP is a protocol with no
  hosted API, so there is nothing to send a definition to.

An unknown id is a usage error (exit 2) that lists the valid ids. Targets are
printed in the order you listed them.

#### `all`

`all` expands to every registered target, in registry order:

```sh
schemaport check ./tools --targets all
# openai, anthropic, gemini, mcp
```

This is **not** the same as omitting `--targets`. Omitting it takes the
command's default, and for `probe` that default is the three hosted providers.
`--targets all` says every one and means it, so:

```sh
schemaport probe ./tools              # openai, anthropic, gemini
schemaport probe ./tools --targets all  # ...and mcp, which reports `skipped`
```

The skipped MCP result explains that there is no endpoint to probe, which is a
more useful answer than three targets appearing where you asked for four.

`all` composes with explicit ids, and puts those first:

```sh
schemaport check ./tools --targets mcp,all
# mcp, openai, anthropic, gemini
```

Naming a target twice does not run it twice.

### `--format text|json`

`text` (the default) is written for a person reading a terminal. `json` prints
exactly one JSON document to stdout and nothing else — see
[output-formats.md](output-formats.md).

### `--config <file>`

Loads defaults from a JSON config file instead of `./schemaport.config.json`.
See [configuration.md](configuration.md). `diff` does not read the config file
and does not accept `--config`.

---

## `schemaport check`

Runs each selected provider's `check()` over each tool and prints the result
grouped by tool, then by target.

```
Tool: refund_order

Gemini
✓ Compatible

MCP
✓ Compatible

Result: 0 errors, 0 warnings
```

A target with no findings prints `✓ Compatible`. Otherwise each finding is one
block:

```
✗ <message>
  Path: <schema path>
  SchemaPort can compile this: <what compile does>
  Docs: <the provider documentation backing the rule>
```

Markers: `✗` error, `⚠` warning, `ℹ` info. The third line reflects the
diagnostic's compile ability — it reads `SchemaPort can compile this with
--allow-lossy:` when the fix weakens the schema, and `SchemaPort cannot compile
this:` when there is no fix. The `Docs:` line only appears when the provider
supplied one.

The trailing `Result:` line counts every finding across every tool and target,
and adds `, N informational` when there are any.

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--targets <ids>` | all four | Targets to check. `all` names every one explicitly. |
| `--format text\|json` | `text` | Output format. |
| `--fail-on error\|warning\|never` | `error` | Exit 1 when a finding at or above this severity exists. `never` always exits 0. |
| `--quiet` | off | Print one headline status per target instead of every diagnostic. Text output only. |
| `--matrix` | off | Print one row per tool and one column per target. Text output only. |
| `--config <file>` | `./schemaport.config.json` | Config file. |

### `--matrix`

`check` prints a block per tool per target. At four targets that is four blocks
a tool, and a forty-tool set produces a hundred and sixty of them — enough that
the question the product exists to answer, *is my tool set portable?*, gets lost
in the output that answers it.

```sh
schemaport check ./tools --targets all --matrix
```

```
Tool           OpenAI  Anthropic  Gemini  MCP
create_ticket    ✗         !        ✗      ✓
refund_order     ✓         !        ✗      ✓
schedule_job     ✓         !        ✗      ✓
tag_resource     ✗         !        ✗      ✓

✓ clean   ! warning   ✗ error   i info
Clean: OpenAI 2/4 · Anthropic 0/4 · Gemini 0/4 · MCP 4/4

Result: 10 errors, 8 warnings
```

Each cell is the **worst severity that target reported** for that tool — the
same rollup `--quiet` prints. `clean` means nothing was reported at all, which
is why a tool with only informational findings shows `i` rather than `✓`.

Two things it deliberately is not:

- **It is not a compile verdict.** An error here can be one compilation repairs:
  `openai/strict-optional-property` is an error and compile fixes it. "Would
  this ship?" is a different question — [`compile`](#schemaport-compile) and
  [`diff --targets`](#target-compatibility) answer it.
- **It is not a second analysis.** It is a rendering of exactly the diagnostics
  the listing would have printed, so the `Result:` line and the exit code are
  identical either way.

The warning and info markers are ASCII rather than the `⚠` and `ℹ` used in the
listing. Both of those default to emoji presentation, which many terminals
render two columns wide while the string reports one character — invisible in
prose, but it shifts every column of a table, differently per terminal.

`--quiet` and `--matrix` are two different summaries of the same thing; passing
both is a usage error rather than a silent preference for one.

### `--quiet`

Text output prints every diagnostic in full. `--quiet` replaces that with one
line per target:

```sh
schemaport check ./tools --quiet
```

It changes what is printed and nothing else. Diagnostics are still collected and
still counted, so **exit codes are unaffected** — a quiet run that finds errors
still exits 1 under the default `--fail-on error`. It also has no effect on
`--format json`, which is already machine-shaped.

`check` is the only command that accepts it.

---

## `schemaport compile`

Compiles each tool for each selected target and writes the results.

```
Tool: refund_order

MCP
✓ generated/mcp/refund-order.json
  No transformations.

Result: 2 files written to generated, 0 refusals
```

### Output layout

```
<out>/
├── manifest.json
├── anthropic/<tool>.json
├── gemini/<tool>.json
├── mcp/<tool>.json
└── openai/<tool>.json
```

The file base name comes from the tool name: `refund_order` becomes
`refund-order.json`. Files are written with a stable two-space JSON formatting
and a trailing newline, so compiling the same input twice produces byte-identical
output — no timestamps anywhere.

### The manifest

```json
{
  "schemaPortVersion": "0.1.0",
  "targets": ["anthropic", "gemini", "mcp", "openai"],
  "tools": [
    {
      "name": "refund_order",
      "source": "examples/refund-order/v1/refund-order.json",
      "targets": {
        "openai": {
          "output": "openai/refund-order.json",
          "transformations": [
            {
              "code": "added-additional-properties-false",
              "path": "inputSchema.additionalProperties",
              "detail": "Added `additionalProperties: false`, which strict mode requires on every object.",
              "lossy": false
            }
          ],
          "warnings": [
            { "code": "openai/strict-optional-property", "path": "inputSchema.properties.amount", "message": "..." }
          ]
        }
      }
    }
  ]
}
```

- `targets` is every selected target, sorted alphabetically.
- `tools` is sorted by tool name; each `targets` object has its keys sorted
  alphabetically.
- `source` is relative to the working directory, with forward slashes. `output`
  is relative to the output directory.
- `warnings` carries the `warning` and `info` diagnostics that survived
  compilation, projected to `{code, path, message}`.
- There are no timestamps and nothing derived from file-system ordering.

### Refusals

SchemaPort never weakens a schema silently. When compiling for a target would
drop or weaken a constraint — a `minimum` the target cannot express, an
open typed map it cannot represent — the compilation is refused:

```
OpenAI
✗ Refused. Nothing was written for this target.
  Compiling for openai would weaken this schema: dropped-additional-properties-schema at inputSchema.properties.tags.additionalProperties. Re-run with --allow-lossy to accept the weaker output.
  Path: inputSchema
  • [safe] renamed-input-schema-to-parameters at inputSchema
    Emitted `inputSchema` as the OpenAI `parameters` field.
  • [lossy] dropped-additional-properties-schema at inputSchema.properties.tags.additionalProperties
    Replaced the `additionalProperties` value schema with `false`; the open typed map is gone.
  Re-run with --allow-lossy to accept the weaker output.
```

A refusal is scoped to that one tool/target pair. Everything that did compile is
still written, the refused pair is left out of the manifest entirely, and the
run exits 1. Pass `--allow-lossy` to accept the weaker output.

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--out <dir>` | — | **Required** (or `output` in the config file). Created if it does not exist. |
| `--targets <ids>` | all four | Targets to compile for. `all` names every one explicitly. |
| `--format text\|json` | `text` | Output format. Files are written either way. |
| `--allow-lossy` | off | Accept transformations that weaken the schema. |
| `--config <file>` | `./schemaport.config.json` | Config file. |

---

## `schemaport probe`

Compiles each tool and asks the provider API whether it accepts the definition.
Only the smallest request that answers that question is sent: the tool
definition, one short synthetic user message and a small output cap. Your
function is never executed and no real data is sent.

```
Tool: refund_order

OpenAI
⚠ ERROR — missing-credentials (not a schema rejection)
  No API key found. Set OPENAI_API_KEY to probe this provider.
  Set the API key:  export OPENAI_API_KEY=<your key>
  Then re-run:      schemaport probe examples/refund-order/v1/refund-order.json

MCP
– SKIPPED
  <the reason the provider reported>

Result: 0 accepted, 0 rejected, 1 error, 1 skipped
```

Four outcomes, each rendered differently:

| Outcome | Meaning | Effect on exit code |
|---|---|---|
| `✓ ACCEPTED` | The provider accepted the compiled definition. Notes report whether a tool call came back and whether its arguments matched the canonical schema. | none |
| `✗ REJECTED` | The provider rejected the schema. The provider's own error message is printed verbatim. | exit 1 |
| `⚠ ERROR` | No verdict: missing credentials, authentication failure, unknown model, rate limit, or network failure. The `errorKind` is printed. | exit 3 (unless something was rejected) |
| `⚠ ERROR` (`compile-refused`) | Compilation was refused, so nothing was sent. This is a finding about your schema, not the environment. | exit 1 |
| `– SKIPPED` | Probing does not apply to this target. | none |

Credentials come from each provider's environment variable
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`). When one is missing,
the output names the exact variable and the exact command to re-run.

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--targets <ids>` | `openai,anthropic,gemini` | Targets to probe. `all` adds `mcp`, which reports `skipped`. |
| `--format text\|json` | `text` | Output format. |
| `--model <id>` | the provider's default probe model | Model to probe with. |
| `--allow-lossy` | off | Allow lossy compilation before probing. Without it, a tool whose compilation is refused is reported as an error, and nothing is sent. |
| `--config <file>` | `./schemaport.config.json` | Config file. |

---

## `schemaport diff`

Compares two tool sets and classifies every change. It loads both sides and
compares them structurally — no provider API is contacted.

```
Tool: refund_order

BREAKING
- Required property `currency` was added. Existing callers do not send it.
  Path: inputSchema.properties.currency
- Enum value `"store_credit"` removed.
  Path: inputSchema.properties.refundMethod.enum

NON-BREAKING
- Optional property `reason` was added.
  Path: inputSchema.properties.reason

INFORMATIONAL
- The description changed.
  Path: inputSchema.properties.orderId.description

Result: 2 breaking, 1 non-breaking, 1 informational
```

Tools that did not change are not printed. When nothing changed at all, the
command prints `No changes.`

### Target compatibility

The output above answers one question: *would a caller written against the old
schema still work?* That is provider-independent, and it is the right default.

It is not the only way a change can hurt. Adding an **optional** property is
textbook non-breaking — the canonical diff says `0 breaking` — but if that
property uses `oneOf`, OpenAI can only express it by widening to `anyOf`, which
is lossy, and the tool stops compiling. The schema got safer for callers and
unshippable for a provider.

`--targets` compiles both sides against each target and reports what changed
about *compatibility*:

```sh
schemaport diff ./v1 ./v2 --targets openai,gemini
```

```
Result: 0 breaking, 1 non-breaking, 0 informational

Target compatibility

OpenAI
  ✗ create_ticket: compiled before, refused now (OpenAI).
      converted-one-of-to-any-of  inputSchema.properties.assignee.oneOf

Gemini
  No compatibility change.

Target result: 1 compatibility regression
```

Three verdicts per tool, per target:

| | Meaning |
|---|---|
| `✗ regressed` | Compiled before, refused now. |
| `✓ fixed` | Was refused, compiles now. |
| `⚠ findings changed` | Still compiles, but diagnostics appeared or went away. |

A refusal names the **transformation responsible and its path**, not the generic
`core/lossy-transformation-refused` that `finalizeCompile` wraps everything in.
`converted-one-of-to-any-of at inputSchema.properties.assignee.oneOf` points at
the change to make; the wrapper points at the whole tool.

Four details worth knowing:

- **Compilation is attempted without `allowLossy`**, because that is the
  question being asked — would this still ship? A tool that only compiles by
  discarding constraints has not stayed compatible.
- **Added and removed tools are skipped.** The canonical diff already reports
  them, and a tool that did not exist cannot have regressed.
- **A compatibility regression is a breaking change** for exit purposes: it
  exits 1 under the default `--fail-on breaking`, not only under `any`.
- **A provider adapter that throws is reported as a refusal**, not a crash. One
  bad adapter should not take the whole diff down.

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--targets <ids>` | none | Also compare per-target compatibility. Accepts `all`. |
| `--format text\|json` | `text` | Output format. |
| `--fail-on breaking\|any\|never` | `breaking` | Exit 1 on breaking changes, a compatibility regression, any change, or never. |

Target analysis is **opt-in**. Without `--targets`, `diff` loads no provider,
compiles nothing, and prints exactly what it printed before — the JSON document
gains no `targets` key either.

`diff` still takes no `--config`; passing it is a usage error. `--targets` is a
direct, unambiguous flag, but a config file is six keys of which four are
meaningless here (`schemas`, `output`, `allowLossy`, `quiet`) and one —
`failOn` — takes a different set of values for `diff` than for `check`. So the
`targets` key in a config file does **not** apply to `diff`; name them on the
command line.
