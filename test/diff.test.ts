import { afterAll, describe, expect, it } from 'vitest';
import { V1, V2, cleanupTempDirs, invoke, parseJson } from './helpers.js';

afterAll(cleanupTempDirs);

describe('diff', () => {
  it('reports the v1 → v2 breaking change and exits 1', async () => {
    const { code, stdout } = await invoke(['diff', V1, V2]);

    expect(code).toBe(1);
    expect(stdout).toContain('Tool: refund_order');
    expect(stdout).toContain('BREAKING');
    expect(stdout).toContain('currency');
    expect(stdout).toContain('Path: inputSchema.properties.currency');
    expect(stdout).toMatch(/Result: [1-9]\d* breaking, \d+ non-breaking, \d+ informational/);
  });

  it('leaves an unchanged tool out of the report', async () => {
    const { stdout } = await invoke(['diff', V1, V2]);
    expect(stdout).not.toContain('search_orders');
  });

  it('exits 0 when the two sides are the same', async () => {
    const { code, stdout } = await invoke(['diff', V1, V1, '--fail-on', 'any']);
    expect(code).toBe(0);
    expect(stdout).toContain('No changes.');
    expect(stdout).toContain('Result: 0 breaking, 0 non-breaking, 0 informational');
  });

  it('honours --fail-on never and --fail-on any', async () => {
    expect((await invoke(['diff', V1, V2, '--fail-on', 'never'])).code).toBe(0);
    expect((await invoke(['diff', V1, V2, '--fail-on', 'any'])).code).toBe(1);
  });

  it('compares single files as well as directories', async () => {
    const { code, stdout } = await invoke([
      'diff',
      `${V1}/refund-order.json`,
      `${V2}/refund-order.json`,
    ]);
    expect(code).toBe(1);
    expect(stdout).toContain('Tool: refund_order');
  });

  it('emits a JSON document with classified changes', async () => {
    const { stdout } = await invoke(['diff', V1, V2, '--format', 'json']);
    const document = parseJson(stdout);

    expect(document['command']).toBe('diff');
    expect(document['schemaPortVersion']).toBe('0.1.0');

    const summary = document['summary'] as {
      breaking: number;
      nonBreaking: number;
      informational: number;
    };
    expect(Object.keys(summary).sort()).toEqual(['breaking', 'informational', 'nonBreaking']);
    expect(summary.breaking).toBeGreaterThan(0);

    const changes = document['changes'] as { classification: string; toolName: string }[];
    expect(changes.length).toBe(summary.breaking + summary.nonBreaking + summary.informational);
    expect(changes.every((change) => change.toolName === 'refund_order')).toBe(true);
    expect(changes.some((change) => change.classification === 'breaking')).toBe(true);
  });
});
