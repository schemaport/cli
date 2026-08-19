# Configuration file

`schemaport` looks for `schemaport.config.json` in the working directory. It is
optional, JSON only, and deliberately small — there is no TypeScript config
loader and no plugin resolution.

```json
{
  "schemas": "tools",
  "targets": ["openai", "anthropic", "gemini", "mcp"],
  "output": "generated",
  "allowLossy": false
}
```

## Keys

| Key | Type | Replaces | Meaning |
|---|---|---|---|
| `schemas` | string | `<path...>` | Default input path (a file or a directory) used when no path is given on the command line. |
| `targets` | string[] | `--targets` | Default target ids. |
| `output` | string | `--out` | Default output directory for `compile`. |
| `allowLossy` | boolean | `--allow-lossy` | Default lossy-compilation setting for `compile` and `probe`. |

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
unknown id exits 2 and lists the valid ids.

`schemas` supplies only a *default*. Any path on the command line replaces it
entirely — the two are never merged.

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
