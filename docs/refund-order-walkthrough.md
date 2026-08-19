# The refund-order walkthrough

The `examples/refund-order` project is the shortest complete tour of what
SchemaPort is for: one tool that four providers treat differently, and a second
version of it that breaks callers.

Run the commands yourself from the package root —
[`examples/README.md`](../examples/README.md) has the full session with the
output as it was actually produced.

## The tools

`examples/refund-order/v1/refund-order.json` defines `refund_order`:

- `orderId` — required string.
- `amount` — **optional** number with `minimum: 0`.
- `refundMethod` — optional string with a three-value enum.

`examples/refund-order/v1/search-orders.json` defines `search_orders`, which
adds an `integer` with bounds, a boolean, and a nested object with its own
`required`.

Between them they exercise the things providers disagree about: optional
properties, numeric bounds, enums, nested objects and open maps.

## Step 1 — `check`

```sh
schemaport check examples/refund-order/v1
```

What to look for in the output:

- **Which target flags what.** The same canonical schema produces different
  findings per provider. That difference is the entire product.
- **The `Path:` line.** Every finding points at a specific place in your schema,
  so you can decide whether to change the schema or accept the transformation.
- **The compile line.** `SchemaPort can compile this: ...` means the finding is
  handled automatically. `SchemaPort can compile this with --allow-lossy: ...`
  means the fix costs you a constraint. `SchemaPort cannot compile this: ...`
  means you have to change the schema.
- **Warnings on a schema that compiles.** A warning is not noise: it is the
  place where the compiled schema behaves differently at runtime from the
  canonical one — for instance an optional property that becomes required and
  nullable, so the model may send `null` where it would previously have omitted
  the key.

Use `--fail-on warning` when you want CI to make you look at those.

## Step 2 — `compile`

```sh
schemaport compile examples/refund-order/v1 --out generated
```

Writes `generated/<target>/<tool>.json` for each of the eight combinations, plus
`generated/manifest.json`.

What to look for:

- **The transformation list per target.** Each line says what changed, where,
  and whether it was `[safe]` or `[lossy]`. Safe means the set of accepted
  argument values is unchanged or still fully constrained; lossy means the
  compiled schema now accepts inputs the canonical schema rejects.
- **The manifest.** It is the audit trail: source path, output path, every
  transformation, every surviving warning. It contains no timestamps, so
  committing `generated/` and failing CI on `git diff --exit-code` works.

## Step 3 — the lossy case

`examples/lossy/tag-resource.json` has `tags` as an open map of strings. A target
that can only express "closed object" or "any object" cannot represent that
without losing something.

```sh
schemaport compile examples/lossy --out generated --targets openai
```

The compilation is refused, nothing is written for that target, and the run
exits 1. This is the rule SchemaPort exists to enforce: a schema is never
quietly weakened. `--allow-lossy` accepts it, and the manifest then records the
transformation with `"lossy": true` so the decision stays visible.

## Step 4 — `probe`

```sh
export OPENAI_API_KEY=...
schemaport probe examples/refund-order/v1 --targets openai
```

`check` encodes what the provider documentation says. `probe` finds out what the
API actually does — which is how you catch a provider changing its validation
without changing its docs.

Without a key the command exits **3** and names the variable to set. It never
reports a missing key as a rejection, because "we could not ask" and "the
provider said no" need different reactions from you and from CI.

## Step 5 — `diff`

`v2` is the same tool set after a release that:

1. added a **required** `currency` — breaking, because existing callers do not
   send it;
2. removed `"store_credit"` from the `refundMethod` enum — breaking, because
   existing callers may send it;
3. added an **optional** `reason` — non-breaking;
4. reworded a description — informational;
5. left `search_orders` byte-identical — so it is not reported at all.

```sh
schemaport diff examples/refund-order/v1 examples/refund-order/v2
```

Exit code 1 on the breaking changes. Run it against the base branch on every
pull request — see [ci.md](ci.md).
