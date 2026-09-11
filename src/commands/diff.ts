import type {
  ChangeClassification,
  LoadedTool,
  SchemaChange,
  SchemaPortProvider,
} from '@schemaport/core';
import { SCHEMAPORT_VERSION, diffToolSets } from '@schemaport/core';
import type { DiffFailOn, OutputFormat } from '../args.js';
import { EXIT } from '../errors.js';
import type { Context } from '../io.js';
import { emitJson } from '../report.js';
import { diffTargets } from '../target-diff.js';
import type { TargetDiffResult, TargetReport } from '../target-diff.js';

export interface DiffInput {
  before: readonly LoadedTool[];
  after: readonly LoadedTool[];
  failOn: DiffFailOn;
  format: OutputFormat;
  /**
   * Targets to analyse compatibility against.
   *
   * Absent means the caller did not pass `--targets`, and `diff` behaves
   * exactly as it did before: canonical changes only, no provider is loaded and
   * no schema is compiled.
   */
  providers?: readonly SchemaPortProvider[];
}

const LABELS: Record<ChangeClassification, string> = {
  breaking: 'BREAKING',
  'non-breaking': 'NON-BREAKING',
  informational: 'INFORMATIONAL',
};

const ORDER: ChangeClassification[] = ['breaking', 'non-breaking', 'informational'];

/** Compare two tool sets. This command never contacts a provider API. */
export function runDiff(ctx: Context, input: DiffInput): number {
  const result = diffToolSets(
    input.before.map((loaded) => loaded.tool),
    input.after.map((loaded) => loaded.tool),
  );

  const targets =
    input.providers === undefined
      ? undefined
      : diffTargets(
          input.before.map((loaded) => loaded.tool),
          input.after.map((loaded) => loaded.tool),
          input.providers,
        );

  if (input.format === 'json') {
    emitJson(ctx, {
      command: 'diff',
      schemaPortVersion: SCHEMAPORT_VERSION,
      summary: {
        ...result.summary,
        ...(targets === undefined ? {} : { targetRegressions: targets.regressions }),
      },
      changes: result.changes,
      ...(targets === undefined ? {} : { targets: targets.reports }),
    });
  } else {
    printText(ctx, result.changes, result.summary);
    if (targets !== undefined) printTargets(ctx, targets);
  }

  if (input.failOn === 'never') return EXIT.ok;

  // A compatibility regression is a breaking change: the tool shipped before
  // and does not ship now. It counts under `breaking` as well as under `any`,
  // because the whole point of asking for targets is to be told about this.
  const regressions = targets?.regressions ?? 0;
  if (input.failOn === 'any') {
    const anything = result.changes.length > 0 || (targets?.reports ?? []).some((r) => r.tools.length > 0);
    return anything ? EXIT.findings : EXIT.ok;
  }
  return result.summary.breaking > 0 || regressions > 0 ? EXIT.findings : EXIT.ok;
}

/** Print the per-target compatibility section, after the canonical changes. */
function printTargets(ctx: Context, result: TargetDiffResult): void {
  ctx.out.line();
  ctx.out.line(ctx.out.bold('Target compatibility'));

  for (const report of result.reports) {
    ctx.out.line();
    ctx.out.line(`${report.displayName}`);
    if (report.tools.length === 0) {
      ctx.out.line('  No compatibility change.');
      continue;
    }
    for (const tool of report.tools) {
      printToolChange(ctx, report, tool);
    }
  }

  ctx.out.line();
  ctx.out.line(
    result.regressions === 0
      ? 'Target result: no compatibility regressions'
      : `Target result: ${String(result.regressions)} compatibility ${
          result.regressions === 1 ? 'regression' : 'regressions'
        }`,
  );
}

function printToolChange(
  ctx: Context,
  report: TargetReport,
  tool: TargetReport['tools'][number],
): void {
  if (tool.verdict === 'regressed') {
    ctx.out.line(
      `  ${ctx.out.red('✗')} ${tool.toolName}: compiled before, refused now (${report.displayName}).`,
    );
    for (const cause of tool.refusedBy) ctx.out.line(`      ${cause.code}  ${cause.path}`);
    return;
  }
  if (tool.verdict === 'fixed') {
    ctx.out.line(`  ${ctx.out.green('✓')} ${tool.toolName}: was refused, compiles now.`);
    return;
  }
  ctx.out.line(`  ${ctx.out.yellow('⚠')} ${tool.toolName}: still compiles, findings changed.`);
  for (const entry of tool.added) ctx.out.line(`      + ${entry.code}  ${entry.path}`);
  for (const entry of tool.resolved) ctx.out.line(`      - ${entry.code}  ${entry.path}`);
}

function printText(
  ctx: Context,
  changes: readonly SchemaChange[],
  summary: { breaking: number; nonBreaking: number; informational: number },
): void {
  if (changes.length === 0) {
    ctx.out.line('No changes.');
    ctx.out.line();
    ctx.out.line('Result: 0 breaking, 0 non-breaking, 0 informational');
    return;
  }

  const byTool = new Map<string, SchemaChange[]>();
  for (const change of changes) {
    const list = byTool.get(change.toolName);
    if (list) list.push(change);
    else byTool.set(change.toolName, [change]);
  }

  for (const [toolName, toolChanges] of byTool) {
    ctx.out.line(`${ctx.out.bold('Tool:')} ${toolName}`);
    for (const classification of ORDER) {
      const group = toolChanges.filter((change) => change.classification === classification);
      if (group.length === 0) continue;
      ctx.out.line();
      ctx.out.line(colourLabel(ctx, classification));
      for (const change of group) {
        ctx.out.line(`- ${change.message}`);
        ctx.out.line(`  Path: ${change.path}`);
      }
    }
    ctx.out.line();
  }

  ctx.out.line(
    `Result: ${summary.breaking} breaking, ${summary.nonBreaking} non-breaking, ` +
      `${summary.informational} informational`,
  );
}

function colourLabel(ctx: Context, classification: ChangeClassification): string {
  const label = LABELS[classification];
  if (classification === 'breaking') return ctx.out.red(label);
  if (classification === 'non-breaking') return ctx.out.green(label);
  return ctx.out.dim(label);
}
