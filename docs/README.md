# schemaport documentation

- [Installation](installation.md) — requirements and install options.
- [Quickstart](quickstart.md) — from a JSON file to compiled output in five
  steps.
- [Commands and flags](commands.md) — `check`, `compile`, `probe`, `diff`, every
  flag, and the manifest format.
- [Output formats](output-formats.md) — text conventions, colour rules, and the
  JSON document each command emits.
- [Exit codes](exit-codes.md) — the 0/1/2/3 table and what each command uses.
- [Configuration file](configuration.md) — `schemaport.config.json` reference.
- [Continuous integration](ci.md) — GitHub Actions snippets, including how to
  treat a failed probe correctly.
- [The refund-order walkthrough](refund-order-walkthrough.md) — the example
  project, step by step.

Provider compatibility rules are not documented here: they live in the provider
packages (`@schemaport/provider-openai`, `-anthropic`, `-gemini`, `-mcp`), each
of which documents its rules, its transformations and the official sources they
came from. The CLI renders whatever those packages report.
