import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '@schemaport/core';

import { buildMatrix } from '../src/matrix.js';

const diagnostic = (severity: Diagnostic['severity']): Diagnostic => ({
  providerId: 'openai',
  toolName: 't',
  severity,
  code: `openai/${severity}`,
  message: severity,
  path: 'inputSchema',
  compile: { supported: true, lossy: false, detail: 'fine' },
});

const source = (toolName: string, per: Record<string, Diagnostic[]>) => ({
  toolName,
  perTarget: Object.entries(per).map(([id, diagnostics]) => ({
    id,
    displayName: id.toUpperCase(),
    diagnostics,
  })),
});

describe('buildMatrix', () => {
  it('takes the worst severity per cell', () => {
    const matrix = buildMatrix([
      source('t', {
        openai: [diagnostic('info'), diagnostic('error'), diagnostic('warning')],
        mcp: [diagnostic('info'), diagnostic('warning')],
        gemini: [diagnostic('info')],
        anthropic: [],
      }),
    ]);

    expect(matrix.rows[0]?.cells.map((cell) => cell.severity)).toEqual([
      'error',
      'warning',
      'info',
      'clean',
    ]);
  });

  it('counts clean tools per target', () => {
    const matrix = buildMatrix([
      source('a', { openai: [], mcp: [diagnostic('error')] }),
      source('b', { openai: [], mcp: [] }),
      source('c', { openai: [diagnostic('warning')], mcp: [] }),
    ]);

    expect(matrix.cleanByTarget).toEqual({ openai: 2, mcp: 2 });
  });

  it('counts a tool with only info findings as not clean', () => {
    // `clean` means nothing was reported at all, which is a stronger and more
    // useful claim than "nothing serious".
    const matrix = buildMatrix([source('a', { openai: [diagnostic('info')] })]);

    expect(matrix.cleanByTarget['openai']).toBe(0);
    expect(matrix.rows[0]?.cells[0]?.severity).toBe('info');
  });

  it('takes the target list and its order from the first tool', () => {
    const matrix = buildMatrix([source('a', { mcp: [], openai: [] })]);

    expect(matrix.targets.map((target) => target.id)).toEqual(['mcp', 'openai']);
  });

  it('preserves the tool order it was given', () => {
    const matrix = buildMatrix([
      source('zebra', { openai: [] }),
      source('apple', { openai: [] }),
    ]);

    expect(matrix.rows.map((row) => row.toolName)).toEqual(['zebra', 'apple']);
  });

  it('handles an empty tool set', () => {
    const matrix = buildMatrix([]);

    expect(matrix.rows).toEqual([]);
    expect(matrix.targets).toEqual([]);
    expect(matrix.cleanByTarget).toEqual({});
  });

  it('reports every target as zero-clean when no tool is clean anywhere', () => {
    const matrix = buildMatrix([
      source('a', { openai: [diagnostic('error')], mcp: [diagnostic('warning')] }),
    ]);

    expect(matrix.cleanByTarget).toEqual({ openai: 0, mcp: 0 });
  });

  it('is deterministic', () => {
    const input = [source('a', { openai: [diagnostic('error')], mcp: [] })];

    expect(buildMatrix(input)).toEqual(buildMatrix(input));
  });
});
