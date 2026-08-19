import type { SchemaPortProvider } from '@schemaport/core';
import { anthropicProvider } from '@schemaport/provider-anthropic';
import { geminiProvider } from '@schemaport/provider-gemini';
import { mcpProvider } from '@schemaport/provider-mcp';
import { openaiProvider } from '@schemaport/provider-openai';
import { UsageError } from './errors.js';

/** The registry used when the caller does not inject one. */
export const DEFAULT_PROVIDERS: readonly SchemaPortProvider[] = [
  openaiProvider,
  anthropicProvider,
  geminiProvider,
  mcpProvider,
];

/** Every target id, in the order results are printed. */
export const ALL_TARGET_IDS = ['openai', 'anthropic', 'gemini', 'mcp'] as const;

/** Targets probed by default. MCP has no hosted API, so it is not included. */
export const DEFAULT_PROBE_TARGET_IDS = ['openai', 'anthropic', 'gemini'] as const;

/**
 * Turn a list of target ids into providers, preserving the requested order.
 *
 * Unknown ids are a usage error rather than a silent skip: a typo in CI should
 * fail loudly, not quietly check three targets instead of four.
 */
export function resolveTargets(
  ids: readonly string[],
  providers: readonly SchemaPortProvider[],
): SchemaPortProvider[] {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const valid = providers.map((provider) => provider.id).join(', ');
  const resolved: SchemaPortProvider[] = [];

  for (const id of ids) {
    const provider = byId.get(id);
    if (!provider) {
      throw new UsageError(`Unknown target \`${id}\`. Valid targets are: ${valid}.`);
    }
    if (!resolved.includes(provider)) resolved.push(provider);
  }

  return resolved;
}

/** Parse a `--targets openai,anthropic` value. */
export function parseTargetList(value: string): string[] {
  const ids = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (ids.length === 0) {
    throw new UsageError('`--targets` needs at least one target id.');
  }
  return ids;
}
