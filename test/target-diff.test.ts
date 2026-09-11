import { describe, expect, it } from 'vitest';
import type {
  CanonicalTool,
  CompileResult,
  JsonSchema,
  SchemaPortProvider,
} from '@schemaport/core';
import { anthropicProvider } from '@schemaport/provider-anthropic';
import { openaiProvider } from '@schemaport/provider-openai';

import { diffTargets } from '../src/target-diff.js';

const tool = (
  name: string,
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): CanonicalTool => ({
  name,
  description: `The ${name} tool`,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
});

const base = tool('create_ticket', { title: { type: 'string' } }, ['title']);
/** Adding an optional `oneOf` property: non-breaking canonically, lossy for OpenAI. */
const withOneOf = tool(
  'create_ticket',
  { title: { type: 'string' }, assignee: { oneOf: [{ type: 'string' }, { type: 'integer' }] } },
  ['title'],
);

const report = (before: CanonicalTool[], after: CanonicalTool[], providers = [openaiProvider]) =>
  diffTargets(before, after, providers);
const openaiTools = (before: CanonicalTool[], after: CanonicalTool[]) =>
  report(before, after).reports[0]?.tools ?? [];

describe('regressions', () => {
  it('reports a tool that compiled before and does not now', () => {
    const result = report([base], [withOneOf]);

    expect(result.regressions).toBe(1);
    const [change] = result.reports[0]?.tools ?? [];
    expect(change?.verdict).toBe('regressed');
    expect(change?.before).toBe(true);
    expect(change?.after).toBe(false);
  });

  it('names the lossy transformation rather than the generic refusal', () => {
    const [change] = openaiTools([base], [withOneOf]);

    expect(change?.refusedBy.map((cause) => cause.code)).toContain('converted-one-of-to-any-of');
    expect(change?.refusedBy.map((cause) => cause.code)).not.toContain(
      'core/lossy-transformation-refused',
    );
  });

  it('points the refusal at the responsible path, not at the whole tool', () => {
    const [change] = openaiTools([base], [withOneOf]);

    expect(change?.refusedBy[0]?.path).toBe('inputSchema.properties.assignee.oneOf');
  });

  it('counts regressions across every target', () => {
    const result = report([base], [withOneOf], [openaiProvider, anthropicProvider]);

    expect(result.reports).toHaveLength(2);
    expect(result.regressions).toBe(result.reports.reduce((sum, r) => sum + r.regressed, 0));
  });
});

describe('the reverse direction', () => {
  it('reports a tool that was refused and now compiles', () => {
    const result = report([withOneOf], [base]);
    const [change] = result.reports[0]?.tools ?? [];

    expect(change?.verdict).toBe('fixed');
    expect(result.regressions).toBe(0);
  });

  it('leaves refusedBy empty for a tool that compiles', () => {
    const [change] = openaiTools([withOneOf], [base]);

    expect(change?.refusedBy).toEqual([]);
  });
});

describe('what it stays quiet about', () => {
  it('says nothing when nothing changed', () => {
    expect(openaiTools([base], [base])).toEqual([]);
  });

  it('says nothing about a tool that was added', () => {
    // A tool that did not exist cannot have regressed; the canonical diff
    // already reports it as added.
    expect(openaiTools([base], [base, tool('brand_new', { a: { type: 'string' } }, ['a'])])).toEqual([]);
  });

  it('says nothing about a tool that was removed', () => {
    const gone = tool('retired', { x: { oneOf: [{ type: 'string' }, { type: 'integer' }] } });

    expect(openaiTools([base, gone], [base])).toEqual([]);
  });

  it('reports a tool that still compiles but whose findings changed', () => {
    const before = tool('t', { a: { type: 'string' } }, ['a']);
    const after = tool('t', { a: { type: 'string' }, b: { type: 'string' } }, ['a']);
    const [change] = openaiTools([before], [after]);

    expect(change?.verdict).toBe('unchanged');
    expect(change?.added.length).toBeGreaterThan(0);
  });

  it('records resolved diagnostics as well as added ones', () => {
    const before = tool('t', { a: { type: 'string' }, b: { type: 'string' } }, ['a']);
    const after = tool('t', { a: { type: 'string' }, b: { type: 'string' } }, ['a', 'b']);
    const [change] = openaiTools([before], [after]);

    expect(change?.resolved.length).toBeGreaterThan(0);
    expect(change?.verdict).toBe('unchanged');
  });
});

describe('determinism', () => {
  it('produces identical output for identical input', () => {
    expect(report([base], [withOneOf])).toEqual(report([base], [withOneOf]));
  });

  it('sorts tools by name regardless of input order', () => {
    const a = tool('aaa', { x: { oneOf: [{ type: 'string' }, { type: 'integer' }] } });
    const z = tool('zzz', { x: { oneOf: [{ type: 'string' }, { type: 'integer' }] } });
    const plain = [tool('aaa', {}), tool('zzz', {})];

    const forward = report(plain, [a, z]).reports[0]?.tools.map((t) => t.toolName);
    const reverse = report(plain, [z, a]).reports[0]?.tools.map((t) => t.toolName);

    expect(forward).toEqual(['aaa', 'zzz']);
    expect(reverse).toEqual(forward);
  });

  it('sorts refusal causes by path then code', () => {
    const [change] = openaiTools([base], [withOneOf]);
    const paths = change?.refusedBy.map((cause) => cause.path) ?? [];

    expect([...paths].sort()).toEqual(paths);
  });
});

describe('a provider adapter that throws', () => {
  /** Throws only on the newer schema, so the throw is itself the regression. */
  const exploding: SchemaPortProvider = {
    id: 'boom',
    displayName: 'Boom',
    rulesReviewedAt: '2026-01-01',
    docs: [],
    check: () => [],
    compile: (candidate): CompileResult => {
      const properties = candidate.inputSchema.properties as Record<string, unknown> | undefined;
      if (properties && 'assignee' in properties) throw new Error('adapter exploded');
      return {
        providerId: 'boom',
        toolName: candidate.name,
        ok: true,
        output: {},
        transformations: [],
        diagnostics: [],
      };
    },
  };

  it('is reported as a refusal rather than crashing the diff', () => {
    const result = diffTargets([base], [withOneOf], [exploding]);
    const [change] = result.reports[0]?.tools ?? [];

    expect(change?.after).toBe(false);
    expect(change?.refusedBy.map((cause) => cause.code)).toContain('boom/adapter-threw');
  });

  it('does not stop the other targets being analysed', () => {
    const result = diffTargets([base], [withOneOf], [exploding, openaiProvider]);

    expect(result.reports.map((r) => r.targetId)).toEqual(['boom', 'openai']);
  });
});
