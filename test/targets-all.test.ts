import { describe, expect, it } from 'vitest';
import type { SchemaPortProvider } from '@schemaport/core';

import { UsageError } from '../src/errors.js';
import { ALL_TARGETS_KEYWORD, DEFAULT_PROVIDERS, resolveTargets } from '../src/targets.js';

const ids = (providers: readonly SchemaPortProvider[]) => providers.map((p) => p.id);
const stub = (id: string): SchemaPortProvider =>
  ({ id, displayName: id, rulesReviewedAt: '2026-01-01', docs: [] }) as unknown as SchemaPortProvider;

describe('--targets all', () => {
  it('expands to every registered provider, in registry order', () => {
    expect(ids(resolveTargets(['all'], DEFAULT_PROVIDERS))).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'mcp',
    ]);
  });

  it('matches naming every id explicitly', () => {
    expect(resolveTargets(['all'], DEFAULT_PROVIDERS)).toEqual(
      resolveTargets(['openai', 'anthropic', 'gemini', 'mcp'], DEFAULT_PROVIDERS),
    );
  });

  it('composes with explicit ids, putting those first', () => {
    expect(ids(resolveTargets(['mcp', 'all'], DEFAULT_PROVIDERS))).toEqual([
      'mcp',
      'openai',
      'anthropic',
      'gemini',
    ]);
  });

  it('does not duplicate a provider named both ways', () => {
    expect(ids(resolveTargets(['all', 'openai', 'all'], DEFAULT_PROVIDERS))).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'mcp',
    ]);
  });

  it('follows an injected registry rather than the built-in list', () => {
    const registry = [stub('one'), stub('two')];

    expect(ids(resolveTargets(['all'], registry))).toEqual(['one', 'two']);
  });

  it('resolves to nothing for an empty registry, without throwing', () => {
    expect(resolveTargets(['all'], [])).toEqual([]);
  });

  it('lets a provider genuinely named `all` win over the shorthand', () => {
    const registry = [stub('all'), stub('other')];

    expect(ids(resolveTargets(['all'], registry))).toEqual(['all']);
  });

  it('lists the shorthand when rejecting an unknown target', () => {
    expect(() => resolveTargets(['openai', 'claude'], DEFAULT_PROVIDERS)).toThrow(UsageError);
    expect(() => resolveTargets(['claude'], DEFAULT_PROVIDERS)).toThrow(
      /Valid targets are: openai, anthropic, gemini, mcp, all\./,
    );
  });

  it('is the keyword the module exports', () => {
    expect(ALL_TARGETS_KEYWORD).toBe('all');
  });

  it('leaves ordinary resolution untouched', () => {
    expect(ids(resolveTargets(['gemini', 'openai'], DEFAULT_PROVIDERS))).toEqual([
      'gemini',
      'openai',
    ]);
  });
});
