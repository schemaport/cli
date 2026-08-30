import type { Diagnostic, LoadedTool, SchemaPortProvider } from '@schemaport/core';
import { SCHEMAPORT_VERSION, countBySeverity, sortDiagnostics } from '@schemaport/core';
import type { CheckFailOn, OutputFormat } from '../args.js';
import { EXIT } from '../errors.js';
import type { Context } from '../io.js';
import { MARK } from '../io.js';
import { relativeToCwd } from '../inputs.js';
import { compileHint, countSummary, emitJson, severityMark } from '../report.js';

export interface CheckInput {
  tools: readonly LoadedTool[];
  providers: readonly SchemaPortProvider[];
  failOn: CheckFailOn;
  format: OutputFormat;
  /**
   * Print only the headline status per target, not the finding blocks.
   *
   * Text output only. JSON is already machine-shaped, so `--quiet` leaves it
   * exactly as it was.
   */
  quiet: boolean;
}

/** Run every selected provider's `check()` over every loaded tool. */
export function runCheck(ctx: Context, input: CheckInput): number {
  const results = input.tools.map((loaded) => ({
    loaded,
    perTarget: input.providers.map((provider) => ({
      provider,
      diagnostics: sortDiagnostics(provider.check(loaded.tool)),
    })),
  }));

  const all = results.flatMap((entry) => entry.perTarget.flatMap((target) => target.diagnostics));
  const totals = countBySeverity(all);

  if (input.format === 'json') {
    emitJson(ctx, {
      command: 'check',
      schemaPortVersion: SCHEMAPORT_VERSION,
      summary: {
        tools: input.tools.length,
        errors: totals.error,
        warnings: totals.warning,
        infos: totals.info,
      },
      tools: results.map((entry) => ({
        name: entry.loaded.tool.name,
        source: relativeToCwd(entry.loaded.sourcePath, ctx.cwd),
        targets: Object.fromEntries(
          entry.perTarget.map((target) => [
            target.provider.id,
            {
              diagnostics: target.diagnostics,
              summary: countBySeverity(target.diagnostics),
            },
          ]),
        ),
      })),
    });
  } else {
    printText(ctx, results, totals, input.quiet);
  }

  return exitCode(input.failOn, totals.error, totals.warning);
}

interface TargetResult {
  provider: SchemaPortProvider;
  diagnostics: Diagnostic[];
}

interface ToolResult {
  loaded: LoadedTool;
  perTarget: TargetResult[];
}

function printText(
  ctx: Context,
  results: readonly ToolResult[],
  totals: { error: number; warning: number; info: number },
  quiet: boolean,
): void {
  if (results.length === 0) {
    ctx.out.line('No tools found.');
    return;
  }

  for (const entry of results) {
    ctx.out.line(`${ctx.out.bold('Tool:')} ${entry.loaded.tool.name}`);
    for (const target of entry.perTarget) {
      ctx.out.line();
      ctx.out.line(ctx.out.bold(target.provider.displayName));
      if (target.diagnostics.length === 0) {
        ctx.out.line(`${ctx.out.green(MARK.ok)} Compatible`);
        continue;
      }
      if (quiet) {
        const counts = countBySeverity(target.diagnostics);
        ctx.out.line(`${severityMark(ctx, worstSeverity(counts))} ${countSummary(counts)}`);
        continue;
      }
      for (const diagnostic of target.diagnostics) {
        ctx.out.line(`${severityMark(ctx, diagnostic.severity)} ${diagnostic.message}`);
        ctx.out.line(`  Path: ${diagnostic.path}`);
        ctx.out.line(`  ${compileHint(diagnostic)}`);
        if (diagnostic.docsUrl !== undefined) {
          ctx.out.line(`  ${ctx.out.dim(`Docs: ${diagnostic.docsUrl}`)}`);
        }
      }
    }
    ctx.out.line();
  }

  ctx.out.line(`Result: ${countSummary(totals)}`);
}

/** The marker a target's headline gets: the most severe thing it reported. */
function worstSeverity(counts: {
  error: number;
  warning: number;
  info: number;
}): Diagnostic['severity'] {
  if (counts.error > 0) return 'error';
  if (counts.warning > 0) return 'warning';
  return 'info';
}

function exitCode(failOn: CheckFailOn, errors: number, warnings: number): number {
  if (failOn === 'never') return EXIT.ok;
  if (failOn === 'warning') return errors + warnings > 0 ? EXIT.findings : EXIT.ok;
  return errors > 0 ? EXIT.findings : EXIT.ok;
}
