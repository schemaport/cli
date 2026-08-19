import type { CommandName } from './args.js';

const GENERAL = `schemaport — define an AI tool schema once, use it everywhere.

Usage:
  schemaport check   <path...>  [--targets <ids>] [--format text|json] [--fail-on error|warning|never] [--config <file>]
  schemaport compile <path...>  --out <dir> [--targets <ids>] [--format text|json] [--allow-lossy] [--config <file>]
  schemaport probe   <path...>  [--targets <ids>] [--format text|json] [--model <id>] [--allow-lossy] [--config <file>]
  schemaport diff    <old> <new> [--format text|json] [--fail-on breaking|any|never]

Commands:
  check     Report where a tool schema is incompatible with each target.
  compile   Write provider-native tool definitions, plus a manifest.
  probe     Send the compiled schema to each provider API and report the verdict.
  diff      Compare two versions of a tool set and classify every change.

Targets:
  openai, anthropic, gemini, mcp
  check and compile default to all four; probe defaults to openai,anthropic,gemini
  because MCP has no hosted API.

Paths:
  Every command accepts a .json file or a directory of them. <path...> may be
  omitted when schemaport.config.json sets "schemas".

Exit codes:
  0  success, nothing at or above the failure threshold
  1  findings: check diagnostics, a refused compilation, breaking changes,
     or a schema a provider rejected during probe
  2  usage or input error
  3  environment error during probe (missing API key, network, unknown model)

Other flags:
  --help, -h     Show this help.
  --version      Print the version.

Docs: https://github.com/schemaport/cli`;

const PER_COMMAND: Record<CommandName, string> = {
  check: `schemaport check <path...>

Runs every selected provider's compatibility rules over each tool and prints
the diagnostics grouped by tool, then by target.

  --targets <ids>              Comma-separated: openai,anthropic,gemini,mcp
  --format text|json           Default: text
  --fail-on error|warning|never  Exit 1 threshold. Default: error
  --config <file>              Config file. Default: ./schemaport.config.json`,

  compile: `schemaport compile <path...> --out <dir>

Compiles each tool for each selected target and writes
<dir>/<target>/<tool>.json plus <dir>/manifest.json.

  --out <dir>          Required (or "output" in the config file).
  --targets <ids>      Comma-separated: openai,anthropic,gemini,mcp
  --format text|json   Default: text
  --allow-lossy        Accept transformations that weaken the schema.
  --config <file>      Config file. Default: ./schemaport.config.json

A tool/target pair whose compilation is refused writes nothing and is left out
of the manifest; the run still writes everything that did compile and exits 1.`,

  probe: `schemaport probe <path...>

Compiles each tool and sends it to the provider API to find out whether the
schema is really accepted. Targets without a hosted API are reported skipped.

  --targets <ids>      Default: openai,anthropic,gemini
  --format text|json   Default: text
  --model <id>         Override the provider's default probe model.
  --allow-lossy        Probe with lossy compilation allowed.
  --config <file>      Config file. Default: ./schemaport.config.json

Exits 1 only when a provider rejected a schema. A missing API key, an unknown
model or a network failure exits 3 and is never reported as a rejection.`,

  diff: `schemaport diff <old> <new>

Compares two tool sets and classifies every change as breaking, non-breaking or
informational. Never contacts a provider API.

  --format text|json               Default: text
  --fail-on breaking|any|never     Exit 1 threshold. Default: breaking`,
};

export function helpText(command?: CommandName): string {
  return command ? PER_COMMAND[command] : GENERAL;
}
