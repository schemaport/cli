import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  CompileResult,
  Diagnostic,
  LoadedTool,
  SchemaPortProvider,
  Transformation,
} from '@schemaport/core';
import { SCHEMAPORT_VERSION, stableStringify, toolFileBaseName, compareStrings} from '@schemaport/core';
import type { OutputFormat } from '../args.js';
import { EXIT } from '../errors.js';
import type { Context } from '../io.js';
import { MARK } from '../io.js';
import { relativeToCwd } from '../inputs.js';
import { emitJson, plural, severityMark } from '../report.js';

export interface CompileInput {
  tools: readonly LoadedTool[];
  providers: readonly SchemaPortProvider[];
  /** Absolute output directory. */
  outDir: string;
  allowLossy: boolean;
  format: OutputFormat;
}

/** One `{code, path, message}` projection of a diagnostic, as stored in the manifest. */
export interface ManifestWarning {
  code: string;
  path: string;
  message: string;
}

export interface ManifestTargetEntry {
  /** Path of the generated file, relative to the output directory. */
  output: string;
  transformations: Transformation[];
  warnings: ManifestWarning[];
}

export interface ManifestTool {
  name: string;
  /** Path the canonical tool was read from, relative to the working directory. */
  source: string;
  targets: Record<string, ManifestTargetEntry>;
}

export interface Manifest {
  schemaPortVersion: string;
  /** Every selected target id, sorted alphabetically. */
  targets: string[];
  tools: ManifestTool[];
}

interface TargetOutcome {
  provider: SchemaPortProvider;
  result: CompileResult;
  /** Relative path written, or `undefined` when the compilation was refused. */
  outputPath?: string;
}

interface ToolOutcome {
  loaded: LoadedTool;
  perTarget: TargetOutcome[];
}

/**
 * Compile every tool for every selected target and write the results.
 *
 * A refused tool/target pair writes nothing and does not appear in the
 * manifest. Everything that did compile is still written, so a partially
 * incompatible tool set produces usable output plus a non-zero exit code.
 */
export function runCompile(ctx: Context, input: CompileInput): number {
  const outcomes: ToolOutcome[] = [];
  let written = 0;
  let refused = 0;

  for (const loaded of input.tools) {
    const perTarget: TargetOutcome[] = [];

    for (const provider of input.providers) {
      const result = provider.compile(loaded.tool, { allowLossy: input.allowLossy });
      if (!result.ok || result.output === undefined) {
        refused += 1;
        perTarget.push({ provider, result });
        continue;
      }

      const relative = `${provider.id}/${toolFileBaseName(loaded.tool.name)}.json`;
      const file = join(input.outDir, provider.id, `${toolFileBaseName(loaded.tool.name)}.json`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, stableStringify(result.output), 'utf8');
      written += 1;
      perTarget.push({ provider, result, outputPath: relative });
    }

    outcomes.push({ loaded, perTarget });
  }

  const manifest = buildManifest(ctx, input, outcomes);
  mkdirSync(input.outDir, { recursive: true });
  writeFileSync(join(input.outDir, 'manifest.json'), stableStringify(manifest), 'utf8');

  const outDisplay = relativeToCwd(input.outDir, ctx.cwd);

  if (input.format === 'json') {
    emitJson(ctx, {
      command: 'compile',
      schemaPortVersion: SCHEMAPORT_VERSION,
      summary: { tools: input.tools.length, written, refused },
      out: outDisplay,
      manifest,
    });
  } else {
    printText(ctx, outcomes, outDisplay, written, refused);
  }

  return refused > 0 ? EXIT.findings : EXIT.ok;
}

/**
 * Build the manifest.
 *
 * Determinism matters more than convenience here: tools are already sorted by
 * name, target keys are inserted in alphabetical order, and nothing derived
 * from the clock or the file system ordering goes in.
 */
function buildManifest(ctx: Context, input: CompileInput, outcomes: readonly ToolOutcome[]): Manifest {
  const targetIds = input.providers.map((provider) => provider.id).sort(compareStrings);

  const tools: ManifestTool[] = [];
  for (const outcome of outcomes) {
    const succeeded = outcome.perTarget
      .filter((entry) => entry.outputPath !== undefined)
      .sort((a, b) => compareStrings(a.provider.id, b.provider.id));
    if (succeeded.length === 0) continue;

    const targets: Record<string, ManifestTargetEntry> = {};
    for (const entry of succeeded) {
      targets[entry.provider.id] = {
        output: entry.outputPath ?? '',
        transformations: entry.result.transformations,
        warnings: entry.result.diagnostics
          .filter((diagnostic) => diagnostic.severity !== 'error')
          .map(toManifestWarning),
      };
    }

    tools.push({
      name: outcome.loaded.tool.name,
      source: relativeToCwd(outcome.loaded.sourcePath, ctx.cwd),
      targets,
    });
  }

  return {
    schemaPortVersion: SCHEMAPORT_VERSION,
    targets: targetIds,
    tools: tools.sort((a, b) => compareStrings(a.name, b.name)),
  };
}

function toManifestWarning(diagnostic: Diagnostic): ManifestWarning {
  return { code: diagnostic.code, path: diagnostic.path, message: diagnostic.message };
}

function printText(
  ctx: Context,
  outcomes: readonly ToolOutcome[],
  outDisplay: string,
  written: number,
  refused: number,
): void {
  if (outcomes.length === 0) {
    ctx.out.line('No tools found.');
    return;
  }

  for (const outcome of outcomes) {
    ctx.out.line(`${ctx.out.bold('Tool:')} ${outcome.loaded.tool.name}`);
    for (const entry of outcome.perTarget) {
      ctx.out.line();
      ctx.out.line(ctx.out.bold(entry.provider.displayName));
      if (entry.outputPath === undefined) {
        printRefusal(ctx, entry);
      } else {
        printSuccess(ctx, entry, entry.outputPath, outDisplay);
      }
    }
    ctx.out.line();
  }

  ctx.out.line(
    `Result: ${plural(written, 'file')} written to ${outDisplay}, ${plural(refused, 'refusal')}`,
  );
}

function printSuccess(
  ctx: Context,
  entry: TargetOutcome,
  outputPath: string,
  outDisplay: string,
): void {
  ctx.out.line(`${ctx.out.green(MARK.ok)} ${outDisplay}/${outputPath}`);
  printTransformations(ctx, entry.result.transformations);
  for (const diagnostic of entry.result.diagnostics) {
    ctx.out.line(`${severityMark(ctx, diagnostic.severity)} ${diagnostic.message}`);
    ctx.out.line(`  Path: ${diagnostic.path}`);
  }
}

function printRefusal(ctx: Context, entry: TargetOutcome): void {
  ctx.out.line(`${ctx.out.red(MARK.error)} Refused. Nothing was written for this target.`);
  for (const diagnostic of entry.result.diagnostics.filter((item) => item.severity === 'error')) {
    ctx.out.line(`  ${diagnostic.message}`);
    ctx.out.line(`  Path: ${diagnostic.path}`);
  }
  printTransformations(ctx, entry.result.transformations);
  if (entry.result.transformations.some((item) => item.lossy)) {
    ctx.out.line('  Re-run with --allow-lossy to accept the weaker output.');
  }
}

function printTransformations(ctx: Context, transformations: readonly Transformation[]): void {
  if (transformations.length === 0) {
    ctx.out.line(`  ${ctx.out.dim('No transformations.')}`);
    return;
  }
  for (const item of transformations) {
    const flag = item.lossy ? ctx.out.yellow('lossy') : ctx.out.dim('safe');
    ctx.out.line(`  • [${flag}] ${item.code} at ${item.path}`);
    ctx.out.line(`    ${item.detail}`);
  }
}
