import type {
  CanonicalTool,
  CompileOptions,
  CompileResult,
  Diagnostic,
  ProbeResult,
  SchemaPortProvider,
} from '@schemaport/core';
import {
  compilable,
  diagnostic,
  finalizeCompile,
  probeAccepted,
  probeMissingCredentials,
  probeRejected,
  transformation,
} from '@schemaport/core';

/**
 * Fake providers.
 *
 * The CLI's job is to render whatever a provider returns and turn it into an
 * exit code. Real provider rules change as the APIs change, so the tests that
 * pin exit codes and rendering drive the CLI with providers whose output is
 * fixed here instead.
 */

function passThrough(id: string, tool: CanonicalTool, options: CompileOptions | undefined, diagnostics: Diagnostic[]): CompileResult {
  return finalizeCompile({
    providerId: id,
    tool,
    output: { name: tool.name, parameters: tool.inputSchema },
    transformations: [],
    diagnostics,
    options,
  });
}

/** Nothing to report: check is empty and compile always succeeds. */
export function compatibleProvider(id = 'openai', displayName = 'Fake OpenAI'): SchemaPortProvider {
  return {
    id,
    displayName,
    rulesReviewedAt: '2026-08-20',
    docs: [],
    apiKeyEnvVar: `${id.toUpperCase()}_API_KEY`,
    check: () => [],
    compile: (tool, options) => passThrough(id, tool, options, []),
  };
}

/** Emits one diagnostic of the given severity that compile can work around. */
export function diagnosingProvider(
  severity: Diagnostic['severity'],
  id = 'anthropic',
  displayName = 'Fake Anthropic',
): SchemaPortProvider {
  const build = (tool: CanonicalTool): Diagnostic[] => [
    diagnostic({
      providerId: id,
      toolName: tool.name,
      severity,
      code: `${id}/fake-${severity}`,
      message: `A fake ${severity} about \`amount\`.`,
      path: 'inputSchema.properties.amount',
      compile: compilable('Emits `amount` as required and nullable.'),
      docsUrl: 'https://example.invalid/docs',
    }),
  ];

  return {
    id,
    displayName,
    rulesReviewedAt: '2026-08-20',
    docs: [],
    check: build,
    compile: (tool, options) => passThrough(id, tool, options, build(tool)),
  };
}

/**
 * Compilation weakens the schema, so `finalizeCompile` refuses it unless the
 * caller passes `allowLossy`.
 */
export function lossyProvider(id = 'gemini', displayName = 'Fake Gemini'): SchemaPortProvider {
  return {
    id,
    displayName,
    rulesReviewedAt: '2026-08-20',
    docs: [],
    check: () => [],
    compile: (tool, options) =>
      finalizeCompile({
        providerId: id,
        tool,
        output: { name: tool.name, parameters: tool.inputSchema },
        transformations: [
          transformation(
            'dropped-minimum',
            'inputSchema.properties.amount.minimum',
            'Dropped `minimum`; the target does not support it.',
            true,
          ),
        ],
        diagnostics: [],
        options,
      }),
  };
}

type ProbeMaker = (tool: CanonicalTool, id: string) => ProbeResult;

/** A provider whose `probe()` returns a fixed result. Never touches the network. */
export function probingProvider(
  make: ProbeMaker,
  id = 'openai',
  displayName = 'Fake OpenAI',
): SchemaPortProvider {
  return {
    ...compatibleProvider(id, displayName),
    probe: (tool) => Promise.resolve(make(tool, id)),
  };
}

export const MISSING_KEY: ProbeMaker = (tool, id) =>
  probeMissingCredentials(
    { providerId: id, toolName: tool.name },
    `${id.toUpperCase()}_API_KEY`,
  );

export const REJECTED: ProbeMaker = (tool, id) =>
  probeRejected({ providerId: id, toolName: tool.name }, 'fake-model-1', {
    message: 'Invalid schema for function: expected an object.',
    status: 400,
    type: 'invalid_request_error',
  });

export const ACCEPTED: ProbeMaker = (tool, id) =>
  probeAccepted({ providerId: id, toolName: tool.name, model: 'fake-model-1', tool });
