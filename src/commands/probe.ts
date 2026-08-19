import type { LoadedTool, ProbeOptions, ProbeResult, SchemaPortProvider } from '@schemaport/core';
import { SCHEMAPORT_VERSION, probeError, probeSkipped, toErrorDetail } from '@schemaport/core';
import type { OutputFormat } from '../args.js';
import { EXIT } from '../errors.js';
import type { Context } from '../io.js';
import { MARK } from '../io.js';
import { relativeToCwd } from '../inputs.js';
import { emitJson, plural } from '../report.js';

export interface ProbeInput {
  tools: readonly LoadedTool[];
  providers: readonly SchemaPortProvider[];
  allowLossy: boolean;
  format: OutputFormat;
  model?: string;
  /** The command to suggest re-running once credentials are set. */
  commandLine: string;
}

interface ProbeOutcome {
  loaded: LoadedTool;
  provider: SchemaPortProvider;
  result: ProbeResult;
}

/**
 * Ask each provider API whether it really accepts the compiled schema.
 *
 * The CLI never decides *why* a probe failed — the provider classifies it and
 * the CLI only renders it. That is what keeps a missing API key from ever being
 * printed as a schema rejection.
 */
export async function runProbe(ctx: Context, input: ProbeInput): Promise<number> {
  const outcomes: ProbeOutcome[] = [];

  for (const loaded of input.tools) {
    for (const provider of input.providers) {
      outcomes.push({
        loaded,
        provider,
        result: await probeOne(provider, loaded, input),
      });
    }
  }

  const summary = {
    accepted: outcomes.filter((entry) => entry.result.status === 'accepted').length,
    rejected: outcomes.filter((entry) => entry.result.status === 'rejected').length,
    errors: outcomes.filter((entry) => entry.result.status === 'error').length,
    skipped: outcomes.filter((entry) => entry.result.status === 'skipped').length,
  };

  if (input.format === 'json') {
    emitJson(ctx, {
      command: 'probe',
      schemaPortVersion: SCHEMAPORT_VERSION,
      summary,
      results: outcomes.map((entry) => ({
        source: relativeToCwd(entry.loaded.sourcePath, ctx.cwd),
        ...entry.result,
      })),
    });
  } else {
    printText(ctx, outcomes, summary, input.commandLine);
  }

  if (summary.rejected > 0) return EXIT.findings;

  // A refused compilation is a finding about the schema, not a problem with the
  // environment: nothing was sent because SchemaPort would not generate the
  // weaker schema. It exits 1 alongside the other findings, so that `--allow-lossy`
  // is what unblocks it rather than a change to the machine.
  const refused = outcomes.some((entry) => entry.result.errorKind === 'compile-refused');
  if (refused) return EXIT.findings;

  if (summary.errors > 0) return EXIT.environment;
  return EXIT.ok;
}

async function probeOne(
  provider: SchemaPortProvider,
  loaded: LoadedTool,
  input: ProbeInput,
): Promise<ProbeResult> {
  const base = { providerId: provider.id, toolName: loaded.tool.name };

  if (typeof provider.probe !== 'function') {
    return probeSkipped(base, `${provider.displayName} has no hosted API to probe.`);
  }

  const options: ProbeOptions = { allowLossy: input.allowLossy };
  if (input.model !== undefined) options.model = input.model;

  try {
    return await provider.probe(loaded.tool, options);
  } catch (error) {
    // A provider adapter that throws is still an environment problem, never a
    // verdict about the schema.
    return probeError(base, 'unknown', toErrorDetail(error));
  }
}

function printText(
  ctx: Context,
  outcomes: readonly ProbeOutcome[],
  summary: { accepted: number; rejected: number; errors: number; skipped: number },
  commandLine: string,
): void {
  if (outcomes.length === 0) {
    ctx.out.line('No tools found.');
    return;
  }

  let currentTool: string | undefined;
  for (const entry of outcomes) {
    if (entry.loaded.tool.name !== currentTool) {
      if (currentTool !== undefined) ctx.out.line();
      currentTool = entry.loaded.tool.name;
      ctx.out.line(`${ctx.out.bold('Tool:')} ${currentTool}`);
    }
    ctx.out.line();
    ctx.out.line(ctx.out.bold(entry.provider.displayName));
    printResult(ctx, entry, commandLine);
  }
  ctx.out.line();

  ctx.out.line(
    `Result: ${summary.accepted} accepted, ${summary.rejected} rejected, ` +
      `${plural(summary.errors, 'error')}, ${summary.skipped} skipped`,
  );
}

function printResult(ctx: Context, entry: ProbeOutcome, commandLine: string): void {
  const { result } = entry;
  const model = result.model === undefined ? '' : ` (model: ${result.model})`;

  switch (result.status) {
    case 'accepted':
      ctx.out.line(`${ctx.out.green(MARK.ok)} ACCEPTED${model}`);
      break;
    case 'rejected':
      ctx.out.line(`${ctx.out.red(MARK.error)} REJECTED${model}`);
      break;
    case 'skipped':
      ctx.out.line(`${ctx.out.dim(MARK.skipped)} SKIPPED`);
      break;
    default:
      ctx.out.line(
        `${ctx.out.yellow(MARK.warning)} ERROR${model} — ${result.errorKind ?? 'unknown'} ` +
          `${ctx.out.dim('(not a schema rejection)')}`,
      );
      break;
  }

  for (const note of result.notes) ctx.out.line(`  ${note}`);

  if (result.providerError !== undefined) {
    // Verbatim: a paraphrased provider error is worse than no error at all.
    ctx.out.line(`  Provider error: ${result.providerError.message}`);
  }

  if (result.argumentErrors !== undefined) {
    for (const message of result.argumentErrors) ctx.out.line(`  Argument error: ${message}`);
  }

  if (result.errorKind === 'missing-credentials') {
    const envVar = entry.provider.apiKeyEnvVar ?? `${entry.provider.id.toUpperCase()}_API_KEY`;
    ctx.out.line(`  Set the API key:  export ${envVar}=<your key>`);
    ctx.out.line(`  Then re-run:      ${commandLine}`);
  }
}
