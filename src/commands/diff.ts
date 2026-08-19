import type { ChangeClassification, LoadedTool, SchemaChange } from '@schemaport/core';
import { SCHEMAPORT_VERSION, diffToolSets } from '@schemaport/core';
import type { DiffFailOn, OutputFormat } from '../args.js';
import { EXIT } from '../errors.js';
import type { Context } from '../io.js';
import { emitJson } from '../report.js';

export interface DiffInput {
  before: readonly LoadedTool[];
  after: readonly LoadedTool[];
  failOn: DiffFailOn;
  format: OutputFormat;
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

  if (input.format === 'json') {
    emitJson(ctx, {
      command: 'diff',
      schemaPortVersion: SCHEMAPORT_VERSION,
      summary: result.summary,
      changes: result.changes,
    });
  } else {
    printText(ctx, result.changes, result.summary);
  }

  if (input.failOn === 'never') return EXIT.ok;
  if (input.failOn === 'any') return result.changes.length > 0 ? EXIT.findings : EXIT.ok;
  return result.summary.breaking > 0 ? EXIT.findings : EXIT.ok;
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
