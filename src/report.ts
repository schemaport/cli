import type { Diagnostic, LoadError } from '@schemaport/core';
import { SCHEMAPORT_VERSION } from '@schemaport/core';
import type { CommandName, OutputFormat } from './args.js';
import { EXIT } from './errors.js';
import type { Context } from './io.js';
import { MARK } from './io.js';
import { relativeToCwd } from './inputs.js';

/** `1 error`, `0 errors`. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Print one JSON document to stdout and nothing else. */
export function emitJson(ctx: Context, document: unknown): void {
  ctx.out.line(JSON.stringify(document, null, 2));
}

/** The marker for a diagnostic severity, coloured when colour is on. */
export function severityMark(ctx: Context, severity: Diagnostic['severity']): string {
  if (severity === 'error') return ctx.out.red(MARK.error);
  if (severity === 'warning') return ctx.out.yellow(MARK.warning);
  return ctx.out.cyan(MARK.info);
}

/**
 * One line saying what `compile` will do about a diagnostic.
 *
 * The provider owns the wording (`compile.detail`); the CLI owns whether the
 * reader needs `--allow-lossy` to get it.
 */
export function compileHint(diagnostic: Diagnostic): string {
  const { supported, lossy, detail } = diagnostic.compile;
  if (!supported) return `SchemaPort cannot compile this: ${detail}`;
  if (lossy) return `SchemaPort can compile this with --allow-lossy: ${detail}`;
  return `SchemaPort can compile this: ${detail}`;
}

/**
 * Report load failures and produce the exit code.
 *
 * Any load error stops the command: a run that silently checked three of four
 * files would be worse than useless in CI.
 */
export function reportLoadErrors(
  ctx: Context,
  command: CommandName,
  format: OutputFormat,
  errors: readonly LoadError[],
): number {
  if (format === 'json') {
    emitJson(ctx, {
      command,
      schemaPortVersion: SCHEMAPORT_VERSION,
      errors: errors.map((error) => ({
        sourcePath: relativeToCwd(error.sourcePath, ctx.cwd),
        message: error.message,
        ...(error.path === undefined ? {} : { path: error.path }),
      })),
    });
    return EXIT.usage;
  }

  for (const error of errors) {
    ctx.err.line(
      `${ctx.err.red(MARK.error)} ${relativeToCwd(error.sourcePath, ctx.cwd)}: ${error.message}`,
    );
    if (error.path !== undefined) ctx.err.line(`  Path: ${error.path}`);
  }
  ctx.err.line(`Result: ${plural(errors.length, 'input error')}`);
  return EXIT.usage;
}
