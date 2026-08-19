# Example tool sets

Everything here is real input you can run the CLI against. From the package
root:

```
examples/
├── refund-order/
│   ├── v1/            refund_order + search_orders, version 1
│   └── v2/            the same two tools after a breaking change
└── lossy/             a tool that restrictive targets cannot express
```

Each version lives in its own directory on purpose: `v1` and `v2` both define a
tool called `refund_order`, and one command may not load two tools with the same
name. Point commands at `examples/refund-order/v1`, never at
`examples/refund-order`.

> The output below was produced by actually running these commands on
> 2026-08-20. Provider compatibility rules live in the provider packages and
> change as the APIs change, so your findings may differ — the shape of the
> output will not.

## 1. check — what will each provider do with this schema?

```sh
schemaport check examples/refund-order/v1/refund-order.json --targets gemini,mcp
```

```
Tool: refund_order

Gemini
✓ Compatible

MCP
✓ Compatible

Result: 0 errors, 0 warnings
```

Drop `--targets` to check all four. Each finding names the schema path and says
whether `compile` can work around it:

```sh
schemaport check examples/refund-order/v1
schemaport check examples/refund-order/v1 --format json | jq '.summary'
schemaport check examples/refund-order/v1 --fail-on warning
```

Exit code 1 means there was a finding at or above the threshold. Use
`--fail-on never` when you only want the report.

## 2. compile — write provider-native definitions

```sh
schemaport compile examples/refund-order/v1 --out generated
```

```
generated/anthropic/refund-order.json
generated/anthropic/search-orders.json
generated/gemini/refund-order.json
generated/gemini/search-orders.json
generated/manifest.json
generated/mcp/refund-order.json
generated/mcp/search-orders.json
generated/openai/refund-order.json
generated/openai/search-orders.json
```

`generated/manifest.json` records where each file came from and what was done to
it. With `--targets mcp` it is small enough to read in full:

```json
{
  "schemaPortVersion": "0.1.0",
  "targets": [
    "mcp"
  ],
  "tools": [
    {
      "name": "refund_order",
      "source": "examples/refund-order/v1/refund-order.json",
      "targets": {
        "mcp": {
          "output": "mcp/refund-order.json",
          "transformations": [],
          "warnings": []
        }
      }
    },
    {
      "name": "search_orders",
      "source": "examples/refund-order/v1/search-orders.json",
      "targets": {
        "mcp": {
          "output": "mcp/search-orders.json",
          "transformations": [],
          "warnings": []
        }
      }
    }
  ]
}
```

Compilation is deterministic: run it twice into two directories and every file
is byte-identical. There are no timestamps anywhere, so the output can be
committed and a CI job can fail on `git diff --exit-code`.

### The lossy example

`examples/lossy/tag-resource.json` has an open string map
(`"additionalProperties": { "type": "string" }`) that some targets cannot
express. Compiling it for such a target is refused rather than quietly weakened:

```sh
schemaport compile examples/lossy --out generated --targets openai
```

```
Tool: tag_resource

OpenAI
✗ Refused. Nothing was written for this target.
  Compiling for openai would weaken this schema: dropped-additional-properties-schema at inputSchema.properties.tags.additionalProperties. Re-run with --allow-lossy to accept the weaker output.
  Path: inputSchema
  • [safe] renamed-input-schema-to-parameters at inputSchema
    Emitted `inputSchema` as the OpenAI `parameters` field.
  • [safe] enabled-strict-mode at inputSchema
    Emitted `strict: true` so OpenAI enforces the schema instead of best-effort matching.
  • [lossy] dropped-additional-properties-schema at inputSchema.properties.tags.additionalProperties
    Replaced the `additionalProperties` value schema with `false`; the open typed map is gone.
  • [safe] added-additional-properties-false at inputSchema.additionalProperties
    Added `additionalProperties: false`, which strict mode requires on every object.
  Re-run with --allow-lossy to accept the weaker output.

Result: 0 files written to generated, 1 refusal
```

Exit code 1, and nothing was written for that target. Accept the weaker output
explicitly when it is what you want:

```sh
schemaport compile examples/lossy --out generated --targets openai --allow-lossy
```

## 3. probe — does the provider really accept it?

```sh
schemaport probe examples/refund-order/v1/refund-order.json --targets openai
```

With no API key set:

```
Tool: refund_order

OpenAI
⚠ ERROR — missing-credentials (not a schema rejection)
  No API key found. Set OPENAI_API_KEY to probe this provider.
  Set the API key:  export OPENAI_API_KEY=<your key>
  Then re-run:      schemaport probe examples/refund-order/v1/refund-order.json --targets openai

Result: 0 accepted, 0 rejected, 1 error, 0 skipped
```

Exit code 3, not 1: "we could not ask" is not "the provider said no". Set the
key and re-run to get a real verdict. `probe` sends only the tool definition and
one short synthetic message — it never calls your function and never sends real
data.

## 4. diff — did this release break callers?

`v2` renames nothing but does four interesting things: it adds a required
`currency`, removes an enum value from `refundMethod`, adds an optional `reason`,
and rewords a description. `search_orders` is byte-identical in both versions.

```sh
schemaport diff examples/refund-order/v1 examples/refund-order/v2
```

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

`search_orders` does not appear: unchanged tools are not reported. Exit code 1,
because breaking changes are the default failure threshold. `--fail-on any` also
fails on the optional property; `--fail-on never` only reports.

`diff` never contacts a provider API, so it is safe to run on every pull
request.
