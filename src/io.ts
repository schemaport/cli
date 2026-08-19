import type { SchemaPortProvider } from '@schemaport/core';

/**
 * Everything `run()` touches from the outside world.
 *
 * All of it is injectable so tests drive the CLI in-process: no child
 * processes, no real stdout, no real provider registry, no `process.exit`.
 */
export interface RunIO {
  /** Working directory used to resolve input paths, `--out` and the config file. */
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  /** Overrides the built-in provider registry. Test seam. */
  providers?: readonly SchemaPortProvider[];
  /** Whether stdout is a terminal. Colour is only ever used when this is true. */
  isTTY?: boolean;
}

/** A resolved, non-optional view of {@link RunIO}. */
export interface Context {
  cwd: string;
  env: Record<string, string | undefined>;
  out: Writer;
  err: Writer;
  providers: readonly SchemaPortProvider[];
  colour: boolean;
}

/** A line-oriented sink with optional ANSI colour. */
export class Writer {
  constructor(
    private readonly write: (chunk: string) => void,
    readonly colour: boolean,
  ) {}

  line(text = ''): void {
    this.write(`${text}\n`);
  }

  raw(text: string): void {
    this.write(text);
  }

  private paint(code: string, text: string): string {
    return this.colour ? `\u001B[${code}m${text}\u001B[0m` : text;
  }

  bold(text: string): string {
    return this.paint('1', text);
  }

  dim(text: string): string {
    return this.paint('2', text);
  }

  red(text: string): string {
    return this.paint('31', text);
  }

  yellow(text: string): string {
    return this.paint('33', text);
  }

  green(text: string): string {
    return this.paint('32', text);
  }

  cyan(text: string): string {
    return this.paint('36', text);
  }
}

/** Severity and status markers, kept in one place so every command matches. */
export const MARK = {
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  ok: '✓',
  skipped: '–',
} as const;
