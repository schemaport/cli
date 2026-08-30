# Output formats

Every command takes `--format text` (the default) or `--format json`.

## Text

Text output is for a person reading a terminal. It groups findings by tool, then
by target, names the schema path for everything, and ends with a `Result:` line
summarising the run.

Markers:

| Marker | Meaning |
|---|---|
| `✓` | Compatible / written / accepted |
| `✗` | Error / refused / rejected |
| `⚠` | Warning, or a probe that produced no verdict |
| `ℹ` | Informational |
| `–` | Skipped |

### Quiet text

`check --quiet` replaces the per-diagnostic listing with one headline status per
target. Findings are still collected and counted, so exit codes are identical
either way — it changes what is printed, not what is found.

It applies to `check` only, and to text only: `--format json` is already
machine-shaped and is unchanged by it.

### Colour

Colour is used only when **stdout is a TTY** and `NO_COLOR` is unset. Piping to a
file or another process gives plain text. JSON output is never coloured.

### Where things are written

Findings and reports go to **stdout**. Load errors and usage errors go to
**stderr** in text mode, so `schemaport check tools/ > report.txt` keeps the
report and still shows the failure.

## JSON

`--format json` prints exactly one JSON document to stdout and nothing else, so
`schemaport check tools/ --format json | jq '.summary'` works.

Every document carries `command` and `schemaPortVersion`.

### check

```json
{
  "command": "check",
  "schemaPortVersion": "0.1.0",
  "summary": { "tools": 2, "errors": 1, "warnings": 3, "infos": 0 },
  "tools": [
    {
      "name": "refund_order",
      "source": "examples/refund-order/v1/refund-order.json",
      "targets": {
        "openai": {
          "diagnostics": [
            {
              "providerId": "openai",
              "toolName": "refund_order",
              "severity": "error",
              "code": "openai/object-missing-additional-properties",
              "message": "OpenAI strict mode requires `additionalProperties: false` on every object schema.",
              "path": "inputSchema.additionalProperties",
              "compile": { "supported": true, "lossy": false, "detail": "Adds `additionalProperties: false`." },
              "docsUrl": "https://developers.openai.com/api/docs/guides/structured-outputs"
            }
          ],
          "summary": { "error": 1, "warning": 0, "info": 0 }
        }
      }
    }
  ]
}
```

Note the two summary shapes: the run-level summary counts `errors`/`warnings`/
`infos`, while each per-target summary counts `error`/`warning`/`info`.

`diagnostics` entries are the provider's `Diagnostic` objects verbatim; `docsUrl`
is present only when the provider supplied one.

### compile

```json
{
  "command": "compile",
  "schemaPortVersion": "0.1.0",
  "summary": { "tools": 2, "written": 8, "refused": 0 },
  "out": "generated",
  "manifest": { "schemaPortVersion": "0.1.0", "targets": ["..."], "tools": ["..."] }
}
```

`manifest` is byte-for-byte the same object written to `<out>/manifest.json`.
Files are written in JSON mode exactly as they are in text mode.

### probe

```json
{
  "command": "probe",
  "schemaPortVersion": "0.1.0",
  "summary": { "accepted": 0, "rejected": 0, "errors": 3, "skipped": 0 },
  "results": [
    {
      "source": "examples/refund-order/v1/refund-order.json",
      "providerId": "openai",
      "toolName": "refund_order",
      "status": "error",
      "schemaAccepted": false,
      "toolCallReturned": false,
      "errorKind": "missing-credentials",
      "notes": ["No API key found. Set OPENAI_API_KEY to probe this provider."]
    }
  ]
}
```

Each entry is a `ProbeResult` with the `source` path added. `status` is
`accepted`, `rejected`, `error` or `skipped`; `errorKind` explains an `error`
(`missing-credentials`, `authentication`, `model-not-found`, `rate-limit`,
`network`, `compile-refused`, `unsupported`, `unknown`). `providerError.message`
is the provider's own message, unmodified.

### diff

```json
{
  "command": "diff",
  "schemaPortVersion": "0.1.0",
  "summary": { "breaking": 2, "nonBreaking": 1, "informational": 1 },
  "changes": [
    {
      "classification": "breaking",
      "code": "required-property-added",
      "toolName": "refund_order",
      "path": "inputSchema.properties.currency",
      "message": "Required property `currency` was added. Existing callers do not send it."
    }
  ]
}
```

`changes` entries may also carry `before` and `after` values when the change is a
modification.

### Errors in JSON mode

Load errors and usage errors do not go to stderr in JSON mode. They come back as
the single stdout document, and the command exits 2:

```json
{
  "command": "check",
  "schemaPortVersion": "0.1.0",
  "errors": [
    { "sourcePath": "tools/broken.json", "message": "Invalid JSON: Unexpected end of JSON input" }
  ]
}
```

A usage error (unknown target, missing `--out`) uses the same shape with a single
`{ "message": "..." }` entry, and `command` is `null` when the command itself
could not be identified.
