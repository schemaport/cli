import { SCHEMAPORT_VERSION } from '@schemaport/core';
import type { CommandName, OutputFormat, ParsedInvocation } from './args.js';
import {
  commandOf,
  parseInvocation,
  readCheckFailOn,
  readDiffFailOn,
  wantsHelp,
  wantsVersion,
} from './args.js';
import { runCheck } from './commands/check.js';
import { runCompile } from './commands/compile.js';
import { runDiff } from './commands/diff.js';
import { runProbe } from './commands/probe.js';
import type { SchemaPortConfig } from './config.js';
import { loadConfig } from './config.js';
import { EXIT, UsageError } from './errors.js';
import { helpText } from './help.js';
import { absolute, loadInputs } from './inputs.js';
import type { Context, RunIO } from './io.js';
import { MARK, Writer } from './io.js';
import { emitJson, reportLoadErrors } from './report.js';
import { DEFAULT_PROBE_TARGET_IDS, DEFAULT_PROVIDERS, resolveTargets } from './targets.js';
import { CLI_VERSION } from './version.js';

/**
 * Run the CLI and return the process exit code.
 *
 * Nothing here calls `process.exit` or writes to `process.stdout` directly, so
 * the whole CLI is testable in-process: pass writers, a working directory and
 * (in tests) a provider registry, and assert on what came back.
 */
export async function run(argv: readonly string[], io: RunIO = {}): Promise<number> {
  const ctx = createContext(io);

  if (wantsVersion(argv)) {
    ctx.out.line(`schemaport ${CLI_VERSION}`);
    ctx.out.line(`@schemaport/core ${SCHEMAPORT_VERSION}`);
    return EXIT.ok;
  }

  if (wantsHelp(argv)) {
    ctx.out.line(helpText(commandOf(argv)));
    return EXIT.ok;
  }

  try {
    return await dispatch(ctx, argv);
  } catch (error) {
    if (error instanceof UsageError) {
      return reportUsageError(ctx, argv, error.message);
    }
    throw error;
  }
}

function createContext(io: RunIO): Context {
  const env = io.env ?? process.env;
  const isTTY = io.isTTY ?? (io.stdout === undefined && process.stdout.isTTY === true);
  const colour = isTTY && env['NO_COLOR'] === undefined;
  const stdout = io.stdout ?? ((chunk: string) => process.stdout.write(chunk));
  const stderr = io.stderr ?? ((chunk: string) => process.stderr.write(chunk));

  return {
    cwd: io.cwd ?? process.cwd(),
    env,
    out: new Writer(stdout, colour),
    err: new Writer(stderr, false),
    providers: io.providers ?? DEFAULT_PROVIDERS,
    colour,
  };
}

async function dispatch(ctx: Context, argv: readonly string[]): Promise<number> {
  const invocation = parseInvocation(argv);
  const { config } = loadConfig(invocation.configPath, ctx.cwd);

  switch (invocation.command) {
    case 'check':
      return check(ctx, invocation, config);
    case 'compile':
      return compile(ctx, invocation, config);
    case 'probe':
      return probe(ctx, invocation, config, argv);
    case 'diff':
      return diff(ctx, invocation);
  }
}

function check(ctx: Context, invocation: ParsedInvocation, config: SchemaPortConfig): number {
  const providers = selectTargets(ctx, invocation, config, false);
  const failOn = readCheckFailOn(invocation.failOn);
  const { tools, errors } = loadInputs(inputPaths(invocation, config), ctx.cwd);
  if (errors.length > 0) return reportLoadErrors(ctx, 'check', invocation.format, errors);

  return runCheck(ctx, { tools, providers, failOn, format: invocation.format });
}

function compile(ctx: Context, invocation: ParsedInvocation, config: SchemaPortConfig): number {
  const providers = selectTargets(ctx, invocation, config, false);
  const out = invocation.out ?? config.output;
  if (out === undefined) {
    throw new UsageError('`--out <dir>` is required for compile (or set `output` in the config file).');
  }

  const { tools, errors } = loadInputs(inputPaths(invocation, config), ctx.cwd);
  if (errors.length > 0) return reportLoadErrors(ctx, 'compile', invocation.format, errors);

  return runCompile(ctx, {
    tools,
    providers,
    outDir: absolute(out, ctx.cwd),
    allowLossy: invocation.allowLossy ?? config.allowLossy ?? false,
    format: invocation.format,
  });
}

async function probe(
  ctx: Context,
  invocation: ParsedInvocation,
  config: SchemaPortConfig,
  argv: readonly string[],
): Promise<number> {
  const providers = selectTargets(ctx, invocation, config, true);
  const { tools, errors } = loadInputs(inputPaths(invocation, config), ctx.cwd);
  if (errors.length > 0) return reportLoadErrors(ctx, 'probe', invocation.format, errors);

  const input = {
    tools,
    providers,
    allowLossy: invocation.allowLossy ?? config.allowLossy ?? false,
    format: invocation.format,
    commandLine: commandLine(argv),
  };
  return invocation.model === undefined
    ? runProbe(ctx, input)
    : runProbe(ctx, { ...input, model: invocation.model });
}

function diff(ctx: Context, invocation: ParsedInvocation): number {
  if (invocation.paths.length !== 2) {
    throw new UsageError('diff takes exactly two paths: `schemaport diff <old> <new>`.');
  }
  const failOn = readDiffFailOn(invocation.failOn);

  const [oldPath, newPath] = invocation.paths as [string, string];
  const before = loadInputs([oldPath], ctx.cwd);
  const after = loadInputs([newPath], ctx.cwd);
  const errors = [...before.errors, ...after.errors];
  if (errors.length > 0) return reportLoadErrors(ctx, 'diff', invocation.format, errors);

  return runDiff(ctx, {
    before: before.tools,
    after: after.tools,
    failOn,
    format: invocation.format,
  });
}

/**
 * Resolve the target list: command line, then config file, then the default.
 *
 * `check` and `compile` default to every registered target. `probe` defaults to
 * the three with a hosted API; MCP is a protocol, so there is nothing to send a
 * tool definition to. An injected registry with unfamiliar ids falls back to
 * whichever of its providers implement `probe()`.
 */
function selectTargets(
  ctx: Context,
  invocation: ParsedInvocation,
  config: SchemaPortConfig,
  forProbe: boolean,
) {
  const ids = invocation.targets ?? config.targets ?? defaultTargetIds(ctx, forProbe);
  return resolveTargets(ids, ctx.providers);
}

function defaultTargetIds(ctx: Context, forProbe: boolean): string[] {
  if (!forProbe) return ctx.providers.map((provider) => provider.id);

  const hosted = ctx.providers.filter((provider) =>
    (DEFAULT_PROBE_TARGET_IDS as readonly string[]).includes(provider.id),
  );
  const usable = hosted.length > 0
    ? hosted
    : ctx.providers.filter((provider) => typeof provider.probe === 'function');
  return usable.map((provider) => provider.id);
}

function inputPaths(invocation: ParsedInvocation, config: SchemaPortConfig): string[] {
  if (invocation.paths.length > 0) return invocation.paths;
  return config.schemas === undefined ? [] : [config.schemas];
}

function commandLine(argv: readonly string[]): string {
  const args = argv.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg));
  return `schemaport ${args.join(' ')}`;
}

function reportUsageError(ctx: Context, argv: readonly string[], message: string): number {
  const format = sniffFormat(argv);
  const command = commandOf(argv);

  if (format === 'json') {
    emitJson(ctx, {
      command: command ?? null,
      schemaPortVersion: SCHEMAPORT_VERSION,
      errors: [{ message }],
    });
    return EXIT.usage;
  }

  ctx.err.line(`${MARK.error} ${message}`);
  ctx.err.line(`Run \`schemaport ${command ?? '--help'}${command ? ' --help' : ''}\` for usage.`);
  return EXIT.usage;
}

/**
 * Find `--format json` without parsing, so a usage error can still be reported
 * as JSON when that is what the caller asked for.
 */
function sniffFormat(argv: readonly string[]): OutputFormat {
  for (const [index, arg] of argv.entries()) {
    if (arg === '--format=json') return 'json';
    if (arg === '--format' && argv[index + 1] === 'json') return 'json';
  }
  return 'text';
}

export type { CommandName };
