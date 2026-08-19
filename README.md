# schemaport

Define an AI tool schema once, then use it across OpenAI, Anthropic, Gemini and
MCP — and find out *before* you ship where the four disagree.

`schemaport` is the command-line surface of SchemaPort. It reads canonical tool
definitions (plain JSON Schema), and:

- **checks** them against each provider's real constraints,
- **compiles** them into provider-native tool definitions, refusing to silently
  weaken a schema,
- **probes** the provider APIs to confirm a schema is genuinely accepted,
- **diffs** two versions of a tool set and tells you which changes break callers.

## Installation

```sh
npm install --save-dev schemaport
npx schemaport --help
```

Node 20 or newer. Installing globally (`npm install -g schemaport`) works too.

## Quickstart

A canonical tool is a JSON file with `name`, an optional `description`, and an
`inputSchema` that is a JSON Schema object:

```json
{
  "name": "refund_order",
  "description": "Refunds all or part of an order",
  "inputSchema": {
    "type": "object",
    "properties": {
      "orderId": { "type": "string", "description": "The order to refund" }
    },
    "required": ["orderId"]
  }
}
```

```sh
# What will each provider do with this schema?
schemaport check tools/

# Write provider-native definitions plus a manifest.
schemaport compile tools/ --out generated/

# Ask the provider APIs whether they really accept it (needs API keys).
schemaport probe tools/

# Did this release break any callers?
schemaport diff v1/ v2/
```

Every command takes a `.json` file or a directory of them.

## Commands

| Command | What it does |
|---|---|
| `schemaport check <path...>` | Reports every incompatibility, with the schema path, an explanation and whether `compile` can work around it. |
| `schemaport compile <path...> --out <dir>` | Writes `<dir>/<target>/<tool>.json` and `<dir>/manifest.json`. Refuses transformations that weaken the schema unless `--allow-lossy` is passed. |
| `schemaport probe <path...>` | Sends the compiled definition to each provider API and reports accepted / rejected / skipped / error. |
| `schemaport diff <old> <new>` | Classifies every change as breaking, non-breaking or informational. Never contacts an API. |

Targets are `openai`, `anthropic`, `gemini` and `mcp`. `check` and `compile`
default to all four; `probe` defaults to `openai,anthropic,gemini`, because MCP
is a protocol with no hosted API to ask.

Full flag reference: [docs/commands.md](docs/commands.md).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. Nothing at or above the failure threshold. |
| `1` | Findings: check diagnostics at or above `--fail-on`, a refused compilation, breaking changes in `diff`, or a schema a provider rejected during `probe`. |
| `2` | Usage or input error: unknown flag or target, missing `--out`, a path that does not exist, malformed canonical JSON, invalid config. |
| `3` | Environment error during `probe` only: missing API key, network failure, unknown model. Never used for a schema rejection. |

A missing API key is always `3`, never `1`. That distinction is the whole point
of `probe`: "we could not ask" and "the provider said no" are different answers.

## Output formats

`--format text` (default) is written for a human reading a terminal.
`--format json` prints exactly one JSON document to stdout and nothing else, so
it can be piped into `jq`. See [docs/output-formats.md](docs/output-formats.md).

Colour is used only when stdout is a TTY and `NO_COLOR` is unset. JSON output is
never coloured.

## Configuration

An optional `schemaport.config.json` in the working directory (or `--config
<file>`) supplies defaults:

```json
{
  "schemas": "tools",
  "targets": ["openai", "anthropic"],
  "output": "generated",
  "allowLossy": false
}
```

Command-line arguments always win. See
[docs/configuration.md](docs/configuration.md).

## Documentation

- [Installation](docs/installation.md)
- [Quickstart](docs/quickstart.md)
- [Commands and flags](docs/commands.md)
- [Output formats](docs/output-formats.md)
- [Exit codes](docs/exit-codes.md)
- [Configuration file](docs/configuration.md)
- [Continuous integration](docs/ci.md)
- [Refund-order walkthrough](docs/refund-order-walkthrough.md)
- [Example tool sets](examples/README.md)

## Using it as a library

The package also exports `run()`, which does everything the binary does and
returns the exit code instead of ending the process:

```ts
import { run } from 'schemaport';

const code = await run(['check', 'tools', '--format', 'json'], {
  cwd: process.cwd(),
  stdout: (chunk) => process.stdout.write(chunk),
});
```

## Licence

MIT
