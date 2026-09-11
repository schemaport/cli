import { parseArgs } from 'node:util';
import { UsageError } from './errors.js';
import { parseTargetList } from './targets.js';

export type CommandName = 'check' | 'compile' | 'probe' | 'diff';
export type OutputFormat = 'text' | 'json';
export type CheckFailOn = 'error' | 'warning' | 'never';
export type DiffFailOn = 'breaking' | 'any' | 'never';

export const COMMANDS: readonly CommandName[] = ['check', 'compile', 'probe', 'diff'];

/** The command line after parsing, before config defaults are merged in. */
export interface ParsedInvocation {
  command: CommandName;
  paths: string[];
  format: OutputFormat;
  /** `--help` after the command name: print that command's reference instead. */
  help?: boolean;
  configPath?: string;
  targets?: string[];
  failOn?: string;
  out?: string;
  allowLossy?: boolean;
  model?: string;
  /** `check --quiet`: print the headline status per target, not every finding. */
  quiet?: boolean;
  /** `check --matrix`: print one row per tool, one column per target. */
  matrix?: boolean;
}

type OptionConfig = Record<string, { type: 'string' | 'boolean'; short?: string }>;

const COMMON: OptionConfig = {
  format: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

const SELECTION: OptionConfig = {
  ...COMMON,
  targets: { type: 'string' },
  config: { type: 'string' },
};

const OPTIONS: Record<CommandName, OptionConfig> = {
  check: {
    ...SELECTION,
    'fail-on': { type: 'string' },
    quiet: { type: 'boolean' },
    matrix: { type: 'boolean' },
  },
  compile: {
    ...SELECTION,
    out: { type: 'string' },
    'allow-lossy': { type: 'boolean' },
  },
  probe: {
    ...SELECTION,
    model: { type: 'string' },
    'allow-lossy': { type: 'boolean' },
  },
  diff: {
    ...COMMON,
    // `--targets` but not `--config`: target analysis on `diff` is opt-in, and
    // the config file's other keys are meaningless here (`out`, `schemas`) or
    // type-incompatible (`failOn` takes a different value set for `diff`).
    targets: { type: 'string' },
    'fail-on': { type: 'string' },
  },
};

/**
 * Whether the invocation is asking for help rather than doing work.
 *
 * Only the leading argument is inspected. `--help` further along the command
 * line is left to `parseArgs`, so `--fail-on --help` is the usage error it
 * really is rather than a help screen.
 */
export function wantsHelp(argv: readonly string[]): boolean {
  const first = argv[0];
  return first === undefined || first === '--help' || first === '-h' || first === 'help';
}

export function wantsVersion(argv: readonly string[]): boolean {
  const first = argv[0];
  return first === '--version' || first === '-V';
}

/** The command named first on the command line, if it is one we know. */
export function commandOf(argv: readonly string[]): CommandName | undefined {
  const first = argv.find((arg) => !arg.startsWith('-'));
  return COMMANDS.find((name) => name === first);
}

/**
 * Parse `argv` (without `node` and the script path) into an invocation.
 *
 * Every failure here is a usage error: unknown command, unknown flag, missing
 * flag value, unknown target, bad `--format`.
 */
export function parseInvocation(argv: readonly string[]): ParsedInvocation {
  const [first, ...rest] = argv;

  if (first === undefined) {
    throw new UsageError('No command given.');
  }
  const command = COMMANDS.find((name) => name === first);
  if (!command) {
    throw new UsageError(`Unknown command \`${first}\`. Valid commands are: ${COMMANDS.join(', ')}.`);
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: [...rest],
      options: OPTIONS[command],
      strict: true,
      allowPositionals: true,
    });
  } catch (error) {
    throw new UsageError(`${messageOf(error)} (run \`schemaport ${command} --help\`)`);
  }

  const values = parsed.values as Record<string, string | boolean | undefined>;
  const invocation: ParsedInvocation = {
    command,
    paths: parsed.positionals,
    format: readFormat(values['format']),
  };

  if (values['help'] === true) invocation.help = true;

  const configPath = values['config'];
  if (typeof configPath === 'string') invocation.configPath = configPath;

  const targets = values['targets'];
  if (typeof targets === 'string') invocation.targets = parseTargetList(targets);

  const failOn = values['fail-on'];
  if (typeof failOn === 'string') invocation.failOn = failOn;

  const out = values['out'];
  if (typeof out === 'string') invocation.out = out;

  const model = values['model'];
  if (typeof model === 'string') invocation.model = model;

  if (values['allow-lossy'] === true) invocation.allowLossy = true;

  if (values['quiet'] === true) invocation.quiet = true;
  if (values['matrix'] === true) invocation.matrix = true;

  // Both replace the per-finding listing with a summary, in different shapes.
  // Silently picking one would hide the other; saying so costs nothing.
  if (invocation.quiet === true && invocation.matrix === true) {
    throw new UsageError('`--quiet` and `--matrix` are two different summaries; pass one.');
  }

  return invocation;
}

function readFormat(value: string | boolean | undefined): OutputFormat {
  if (value === undefined) return 'text';
  if (value === 'text' || value === 'json') return value;
  throw new UsageError(`Unknown --format \`${String(value)}\`. Valid formats are: text, json.`);
}

/** Validate `--fail-on` for `check`. */
export function readCheckFailOn(value: string | undefined): CheckFailOn {
  if (value === undefined) return 'error';
  if (value === 'error' || value === 'warning' || value === 'never') return value;
  throw new UsageError(`Unknown --fail-on \`${value}\`. Valid values are: error, warning, never.`);
}

/** Validate `--fail-on` for `diff`. */
export function readDiffFailOn(value: string | undefined): DiffFailOn {
  if (value === undefined) return 'breaking';
  if (value === 'breaking' || value === 'any' || value === 'never') return value;
  throw new UsageError(`Unknown --fail-on \`${value}\`. Valid values are: breaking, any, never.`);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
