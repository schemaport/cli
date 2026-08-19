# Quickstart

## 1. Write a canonical tool

A canonical tool is plain JSON: a `name`, an optional `description`, and an
`inputSchema` that is a JSON Schema object.

`tools/refund-order.json`:

```json
{
  "name": "refund_order",
  "description": "Refunds all or part of an order",
  "inputSchema": {
    "type": "object",
    "properties": {
      "orderId": { "type": "string", "description": "The order to refund" },
      "amount": { "type": "number", "minimum": 0 }
    },
    "required": ["orderId"]
  }
}
```

A `.json` file may hold one tool object, an array of tool objects, or
`{ "tools": [ ... ] }`. A directory is read recursively; `node_modules`, `dist`
and `coverage` are skipped, and tool names must be unique across everything the
command loads.

## 2. Check it

```sh
schemaport check tools/
```

Each target gets a section under each tool. Every finding names the schema path
and says what `compile` will do about it. Exit code 1 means there was at least
one error-severity finding.

## 3. Compile it

```sh
schemaport compile tools/ --out generated/
```

```
generated/
├── manifest.json
├── anthropic/refund-order.json
├── gemini/refund-order.json
├── mcp/refund-order.json
└── openai/refund-order.json
```

Each file is the provider-native tool definition, ready to send to that
provider's API. `manifest.json` records where each output came from, every
transformation applied, and every warning that survived compilation.

If compiling for a target would drop or weaken a constraint, the command refuses
it, writes nothing for that tool/target pair, tells you which transformation was
lossy, and exits 1. Re-run with `--allow-lossy` when the weaker output is what
you want.

## 4. Probe it

```sh
export OPENAI_API_KEY=...
schemaport probe tools/ --targets openai
```

`probe` compiles the tool and sends the smallest possible request that answers
"does this provider accept this schema?". It never executes your function and
never sends real data.

Without a key, `probe` exits 3 and names the variable to set. It never reports a
missing key as a schema rejection.

## 5. Diff it before you ship

```sh
schemaport diff v1/ v2/
```

Breaking changes exit 1. `--fail-on any` fails on any change at all;
`--fail-on never` only reports.

## Next

- [Commands and flags](commands.md)
- [Configuration file](configuration.md)
- [Continuous integration](ci.md)
- [The refund-order walkthrough](refund-order-walkthrough.md)
