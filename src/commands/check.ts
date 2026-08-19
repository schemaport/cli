import type { Diagnostic, LoadedTool, SchemaPortProvider } from '@schemaport/core';
import { SCHEMAPORT_VERSION, countBySeverity, sortDiagnostics } from '@schemaport/core';
import type { CheckFailOn, OutputFormat } from '../args.js';
import { EXIT } from '../errors.js';
import type { Context } from '../io.js';
import { MARK } from '../io.js';
import { relativeToCwd } from '../inputs.js';
import { compileHint, emitJson, plural, severityMark } from '../report.js';

export interface CheckInput {
  tools: readonly LoadedTool[];
  providers: readonly SchemaPortProvider[];
  failOn: CheckFailOn;
  format: OutputFormat;
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
    printText(ctx, results, totals);
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

  const parts = [plural(totals.error, 'error'), plural(totals.warning, 'warning')];
  if (totals.info > 0) parts.push(`${totals.info} informational`);
  ctx.out.line(`Result: ${parts.join(', ')}`);
}

function exitCode(failOn: CheckFailOn, errors: number, warnings: number): number {
  if (failOn === 'never') return EXIT.ok;
  if (failOn === 'warning') return errors + warnings > 0 ? EXIT.findings : EXIT.ok;
  return errors > 0 ? EXIT.findings : EXIT.ok;
}
