# Commands and flags

```
schemaport check   <path...>  [--targets <ids>] [--format text|json] [--fail-on error|warning|never] [--quiet] [--config <file>]
schemaport compile <path...>  --out <dir> [--targets <ids>] [--format text|json] [--allow-lossy] [--config <file>]
schemaport probe   <path...>  [--targets <ids>] [--format text|json] [--model <id>] [--allow-lossy] [--config <file>]
schemaport diff    <old> <new> [--format text|json] [--fail-on breaking|any|never]
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

A comma-separated list of `openai`, `anthropic`, `gemini`, `mcp`.

- `check`, `compile`: all four by default.
- `probe`: `openai,anthropic,gemini` by default. MCP is a protocol with no
  hosted API, so there is nothing to send a definition to.

An unknown id is a usage error (exit 2) that lists the valid ids. Targets are
printed in the order you listed them.

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
| `--targets <ids>` | all four | Targets to check. |
| `--format text\|json` | `text` | Output format. |
| `--fail-on error\|warning\|never` | `error` | Exit 1 when a finding at or above this severity exists. `never` always exits 0. |
| `--quiet` | off | Print one headline status per target instead of every diagnostic. Text output only. |
| `--config <file>` | `./schemaport.config.json` | Config file. |

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
| `--targets <ids>` | all four | Targets to compile for. |
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
| `--targets <ids>` | `openai,anthropic,gemini` | Targets to probe. |
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

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--format text\|json` | `text` | Output format. |
| `--fail-on breaking\|any\|never` | `breaking` | Exit 1 on breaking changes, on any change, or never. |

`diff` takes neither `--targets` nor `--config`; passing them is a usage error.
