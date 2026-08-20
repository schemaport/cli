# Exit codes

| Code | Name | When |
|---|---|---|
| `0` | Success | The command ran and found nothing at or above its failure threshold. |
| `1` | Findings | The command ran and found something: `check` diagnostics at or above `--fail-on`, a refused (lossy) compilation, breaking changes in `diff` at or above `--fail-on`, or a schema a provider rejected during `probe`. |
| `2` | Usage or input error | The command could not run: unknown command, unknown flag, missing flag value, unknown target id, missing `--out`, a path that does not exist, invalid JSON, a file that is not a valid canonical tool, a duplicate tool name, or an invalid config file. |
| `3` | Environment error | `probe` only. No verdict was reached because of the environment: missing API key, authentication failure, unknown model, rate limit, or network failure. A refused compilation is **not** in this category — see below. |

## Per command

### check

| `--fail-on` | Exits 1 when |
|---|---|
| `error` (default) | any `error` diagnostic exists |
| `warning` | any `error` or `warning` diagnostic exists |
| `never` | never — always exits 0 |

`info` diagnostics never affect the exit code.

### compile

- `0` — every tool compiled for every selected target.
- `1` — at least one tool/target pair was refused. Everything else was still
  written, and the manifest lists only what was written.
- `2` — usage or input error, including a missing `--out`.

### probe

- `0` — nothing was rejected and nothing errored. Accepted and skipped results
  both count as success.
- `1` — at least one provider **rejected** a schema. This is the only probe
  outcome that means "your schema is wrong".
- `3` — nothing was rejected, but at least one probe produced no verdict.

A missing API key is `3`, never `1`. So is a stale `--model`, a rate limit and a
network failure. If you want CI to treat "could not probe" as success, branch on
the exit code:

```sh
schemaport probe tools/ || [ $? -eq 3 ]
```

### diff

| `--fail-on` | Exits 1 when |
|---|---|
| `breaking` (default) | any breaking change exists |
| `any` | any change exists at all |
| `never` | never — always exits 0 |

## Notes

- Exit code 1 always means "the CLI worked and this is what it found". Exit code
  2 always means "the CLI could not do the work you asked for".
- An unexpected internal failure (for example, the output directory is not
  writable) is also reported on stderr and exits 2.

## A refused compilation during `probe` exits 1, not 3

`probe` compiles each tool before sending it. When compilation is refused
because a transformation would weaken the schema, nothing is sent — but that is
a finding about your schema, not a problem with the machine:

```bash
schemaport probe ./examples/lossy --targets openai
# exit 1
```

`--allow-lossy` is what unblocks it. Exit code 3 is reserved for causes outside
your schema: a missing key, a bad key, an unknown model, a rate limit, or a
network failure.

The check is run-wide and ordered. One refused compilation makes the whole run
exit 1, even when every other target failed for a missing key.
