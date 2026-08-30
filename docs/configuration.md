# Configuration file

`schemaport` looks for `schemaport.config.json` in the working directory. It is
optional, JSON only, and deliberately small — there is no TypeScript config
loader and no plugin resolution.

```json
{
  "schemas": "tools",
  "targets": ["openai", "anthropic", "gemini", "mcp"],
  "output": "generated",
  "allowLossy": false,
  "quiet": false,
  "failOn": "error"
}
```

## Keys

| Key | Type | Replaces | Meaning |
|---|---|---|---|
| `schemas` | string | `<path...>` | Default input path (a file or a directory) used when no path is given on the command line. |
| `targets` | string[] | `--targets` | Default target ids. Accepts `"all"` as a shorthand for every target. |
| `output` | string | `--out` | Default output directory for `compile`. |
| `allowLossy` | boolean | `--allow-lossy` | Default lossy-compilation setting for `compile` and `probe`. |
| `quiet` | boolean | `--quiet` | Default quiet output for `check`. Text output only. |
| `failOn` | `"error"` \| `"warning"` \| `"never"` | `--fail-on` | Default exit-1 threshold for `check`. |

Any other key is a usage error, as is a value of the wrong type. Paths are
resolved relative to the working directory, not to the config file.

## Precedence

Command-line arguments always win:

```sh
# targets from the config file
schemaport check

# --targets overrides it
schemaport check --targets mcp
```

`--targets` from the config file is validated the same way as the flag: an
unknown id exits 2 and lists the valid ids, and `"all"` expands the same way:

```json
{ "targets": ["all"] }
```

`schemas` supplies only a *default*. Any path on the command line replaces it
entirely — the two are never merged.

## `quiet` and `failOn` apply to `check` only

Both keys are read by `check` and by nothing else.

`quiet` affects **text output only**. `--format json` is already machine-shaped,
so it is unchanged either way. Exit codes are unaffected: a quiet run that finds
errors still exits 1.

`failOn` is the `check` threshold and takes `error`, `warning` or `never`.
`diff` also has a `--fail-on` flag, but it takes a different set of values
(`breaking`, `any`, `never`) and **does not read this key** — `diff` is
configured on the command line only, along with `--targets` and `--config`,
which it does not accept at all. A config file carrying `failOn: "warning"`
changes what `check` does and leaves `diff` on its own default of `breaking`.

## `--config <file>`

```sh
schemaport check --config config/schemaport.ci.json
```

The path is resolved relative to the working directory. A `--config` file that
does not exist is a usage error (exit 2); a missing `schemaport.config.json` is
not, because the file is optional by design.

`diff` does not read the config file and does not accept `--config`: it takes its
two paths explicitly and contacts no providers, so there is nothing to configure.

## Example project

```
my-agent/
├── schemaport.config.json
├── tools/
│   ├── refund-order.json
│   └── search-orders.json
└── generated/
```

```json
{
  "schemas": "tools",
  "output": "generated"
}
```

```sh
schemaport check      # checks tools/ against all four targets
schemaport compile    # writes generated/
```
