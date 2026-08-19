# Installation

`schemaport` is a Node CLI. It needs **Node 20 or newer** (it uses `parseArgs`
from `node:util` and ES modules).

## In a project

```sh
npm install --save-dev schemaport
```

Then run it through `npx`, or from an npm script:

```sh
npx schemaport check tools/
```

```json
{
  "scripts": {
    "tools:check": "schemaport check tools/",
    "tools:build": "schemaport compile tools/ --out generated/"
  }
}
```

Installing it as a dev dependency is the recommended form: the compiled output
and the manifest are tied to the version that produced them, and a pinned
version keeps CI stable when provider rules change.

## Globally

```sh
npm install -g schemaport
schemaport --version
```

## What gets installed

The package ships `dist/`, `docs/`, `examples/`, the README, the changelog and
the licence. Its only runtime dependencies are `@schemaport/core` and the four
provider packages:

- `@schemaport/provider-openai`
- `@schemaport/provider-anthropic`
- `@schemaport/provider-gemini`
- `@schemaport/provider-mcp`

There is no argument-parsing dependency and no plugin system.

## Verifying the install

```sh
schemaport --version
schemaport --help
```

`--version` prints the CLI version and the version of `@schemaport/core` it was
built against.
