import { afterAll, describe, expect, it } from 'vitest';
import { REFUND_V1, V1, cleanupTempDirs, invoke, parseJson } from './helpers.js';
import { compatibleProvider, diagnosingProvider } from './fakes.js';

afterAll(cleanupTempDirs);

describe('check with the real provider registry', () => {
  it('accepts a single file and prints a section per target', async () => {
    const { code, stdout } = await invoke(['check', REFUND_V1, '--fail-on', 'never']);
    expect(code).toBe(0);
    expect(stdout).toContain('Tool: refund_order');
    for (const displayName of ['OpenAI', 'Anthropic', 'Gemini', 'MCP']) {
      expect(stdout).toContain(displayName);
    }
    expect(stdout).toMatch(/Result: \d+ errors?, \d+ warnings?/);
  });

  it('accepts a directory and checks every tool in it', async () => {
    const { stdout } = await invoke(['check', V1, '--fail-on', 'never']);
    expect(stdout).toContain('Tool: refund_order');
    expect(stdout).toContain('Tool: search_orders');
  });

  it('limits the run to the selected targets', async () => {
    const { stdout } = await invoke(['check', REFUND_V1, '--targets', 'gemini,mcp', '--fail-on', 'never']);
    expect(stdout).toContain('Gemini');
    expect(stdout).toContain('MCP');
    expect(stdout).not.toContain('OpenAI');
    expect(stdout).not.toContain('Anthropic');
  });

  it('emits a JSON document with the documented shape', async () => {
    const { stdout } = await invoke(['check', V1, '--format', 'json', '--targets', 'openai,mcp']);
    const document = parseJson(stdout);

    expect(document['command']).toBe('check');
    expect(document['schemaPortVersion']).toBe('0.1.0');

    const summary = document['summary'] as Record<string, number>;
    expect(Object.keys(summary).sort()).toEqual(['errors', 'infos', 'tools', 'warnings']);
    expect(summary['tools']).toBe(2);

    const tools = document['tools'] as {
      name: string;
      source: string;
      targets: Record<string, { diagnostics: unknown[]; summary: Record<string, number> }>;
    }[];
    expect(tools.map((tool) => tool.name)).toEqual(['refund_order', 'search_orders']);
    expect(tools[0]?.source).toBe('examples/refund-order/v1/refund-order.json');
    expect(Object.keys(tools[0]?.targets ?? {})).toEqual(['openai', 'mcp']);

    const openai = tools[0]?.targets['openai'];
    expect(Array.isArray(openai?.diagnostics)).toBe(true);
    expect(Object.keys(openai?.summary ?? {}).sort()).toEqual(['error', 'info', 'warning']);
  });
});

describe('check exit codes', () => {
  it('exits 0 and prints ✓ Compatible when nothing is reported', async () => {
    const { code, stdout } = await invoke(['check', REFUND_V1], {
      providers: [compatibleProvider()],
    });
    expect(code).toBe(0);
    expect(stdout).toContain('✓ Compatible');
    expect(stdout).toContain('Result: 0 errors, 0 warnings');
  });

  it('exits 1 on an error diagnostic', async () => {
    const { code, stdout } = await invoke(['check', REFUND_V1], {
      providers: [diagnosingProvider('error')],
    });
    expect(code).toBe(1);
    expect(stdout).toContain('✗ A fake error about `amount`.');
    expect(stdout).toContain('Path: inputSchema.properties.amount');
    expect(stdout).toContain('SchemaPort can compile this: Emits `amount` as required and nullable.');
  });

  it('ignores warnings by default and honours --fail-on warning', async () => {
    const providers = [diagnosingProvider('warning')];

    expect((await invoke(['check', REFUND_V1], { providers })).code).toBe(0);
    expect((await invoke(['check', REFUND_V1, '--fail-on', 'warning'], { providers })).code).toBe(1);
    expect((await invoke(['check', REFUND_V1, '--fail-on', 'never'], { providers })).code).toBe(0);
  });

  it('never fails with --fail-on never, even with errors', async () => {
    const { code } = await invoke(['check', REFUND_V1, '--fail-on', 'never'], {
      providers: [diagnosingProvider('error')],
    });
    expect(code).toBe(0);
  });

  it('marks info diagnostics without failing', async () => {
    const { code, stdout } = await invoke(['check', REFUND_V1, '--fail-on', 'warning'], {
      providers: [diagnosingProvider('info')],
    });
    expect(code).toBe(0);
    expect(stdout).toContain('ℹ A fake info about `amount`.');
  });
});
