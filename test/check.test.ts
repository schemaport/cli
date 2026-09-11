import { afterAll, describe, expect, it } from 'vitest';
import { REFUND_V1, V1, cleanupTempDirs, invoke, parseJson, tempDir, writeFile } from './helpers.js';
import { compatibleProvider, diagnosingProvider } from './fakes.js';

afterAll(cleanupTempDirs);

const DISPLAY_NAMES = ['OpenAI', 'Anthropic', 'Gemini', 'MCP'];

/** The provider section headers in the order they were printed, de-duplicated. */
function sectionHeaders(stdout: string): string[] {
  const seen: string[] = [];
  for (const line of stdout.split('\n')) {
    if (DISPLAY_NAMES.includes(line) && !seen.includes(line)) seen.push(line);
  }
  return seen;
}

describe('check with the real provider registry', () => {
  it('accepts a single file and prints a section per target', async () => {
    const { code, stdout } = await invoke(['check', REFUND_V1, '--fail-on', 'never']);
    expect(code).toBe(0);
    expect(stdout).toContain('Tool: refund_order');
    expect(sectionHeaders(stdout)).toEqual(DISPLAY_NAMES);
    expect(stdout).toMatch(/Result: \d+ errors?, \d+ warnings?/);
  });

  it('accepts a directory and checks every tool in it', async () => {
    const { stdout } = await invoke(['check', V1, '--fail-on', 'never']);
    expect(stdout).toContain('Tool: refund_order');
    expect(stdout).toContain('Tool: search_orders');
  });

  it('limits the run to the selected targets', async () => {
    const { stdout } = await invoke(['check', REFUND_V1, '--targets', 'gemini,mcp', '--fail-on', 'never']);
    // Section headers are whole lines; a provider message that happens to name
    // another vendor must not be mistaken for one.
    expect(sectionHeaders(stdout)).toEqual(['Gemini', 'MCP']);
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

describe('check --quiet', () => {
  it('prints the headline status per target and no finding blocks', async () => {
    const { stdout } = await invoke(['check', REFUND_V1, '--quiet', '--fail-on', 'never'], {
      providers: [diagnosingProvider('error'), compatibleProvider()],
    });

    expect(stdout).toContain('✗ 1 error, 0 warnings');
    expect(stdout).toContain('✓ Compatible');
    expect(stdout).toContain('Result: 1 error, 0 warnings');

    // Everything a finding block is made of is gone.
    expect(stdout).not.toContain('A fake error about');
    expect(stdout).not.toContain('Path:');
    expect(stdout).not.toContain('SchemaPort can compile this');
    expect(stdout).not.toContain('Docs:');
  });

  it('counts informational findings in the headline', async () => {
    const { stdout } = await invoke(['check', REFUND_V1, '--quiet', '--fail-on', 'never'], {
      providers: [diagnosingProvider('info')],
    });
    expect(stdout).toContain('ℹ 0 errors, 0 warnings, 1 informational');
  });

  it('keeps every tool and target heading, and the same Result line', async () => {
    const loud = await invoke(['check', V1, '--fail-on', 'never']);
    const quiet = await invoke(['check', V1, '--quiet', '--fail-on', 'never']);

    expect(sectionHeaders(quiet.stdout)).toEqual(sectionHeaders(loud.stdout));
    expect(quiet.stdout).toContain('Tool: refund_order');
    expect(quiet.stdout).toContain('Tool: search_orders');
    expect(quiet.stdout).toMatch(/✗ \d+ errors?, \d+ warnings?/);
    expect(quiet.stdout).not.toContain('  Path: ');

    const resultLine = (out: string) => out.split('\n').find((line) => line.startsWith('Result:'));
    expect(resultLine(quiet.stdout)).toBe(resultLine(loud.stdout));
    expect(quiet.stdout.length).toBeLessThan(loud.stdout.length);
  });

  it('does not change the exit code', async () => {
    for (const failOn of ['error', 'warning', 'never']) {
      const loud = await invoke(['check', V1, '--fail-on', failOn]);
      const quiet = await invoke(['check', V1, '--quiet', '--fail-on', failOn]);
      expect(quiet.code).toBe(loud.code);
    }
  });

  it('leaves --format json byte-identical', async () => {
    const plain = await invoke(['check', V1, '--format', 'json']);
    const quiet = await invoke(['check', V1, '--quiet', '--format', 'json']);

    expect(quiet.stdout).toBe(plain.stdout);
    expect(quiet.code).toBe(plain.code);
  });

  it('is a check-only flag', async () => {
    const { code, stderr } = await invoke(['compile', V1, '--out', 'generated', '--quiet']);
    expect(code).toBe(2);
    expect(stderr).toContain('--quiet');
  });

  it('is listed in `check --help`', async () => {
    const { code, stdout } = await invoke(['check', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--quiet');
  });
});

describe('check --matrix', () => {
  it('prints one row per tool and one column per target', async () => {
    const { stdout } = await invoke(['check', V1, '--targets', 'openai,mcp', '--matrix']);
    const lines = stdout.split('\n');

    expect(lines[0]).toMatch(/^Tool\s+OpenAI\s+MCP$/);
    expect(stdout).toContain('Clean: OpenAI');
    expect(stdout).toContain('MCP');
  });

  it('prints a legend, because two markers are not the usual glyphs', async () => {
    const { stdout } = await invoke(['check', V1, '--targets', 'mcp', '--matrix']);

    expect(stdout).toContain('! warning');
    expect(stdout).toContain('i info');
  });

  it('leaves no trailing whitespace on a row', async () => {
    const { stdout } = await invoke(['check', V1, '--targets', 'openai,mcp', '--matrix']);

    for (const line of stdout.split('\n')) expect(line).toBe(line.trimEnd());
  });

  it('still prints the Result line and keeps the exit code', async () => {
    const listed = await invoke(['check', V1, '--targets', 'openai']);
    const matrixed = await invoke(['check', V1, '--targets', 'openai', '--matrix']);

    expect(matrixed.code).toBe(listed.code);
    const resultLine = listed.stdout.split('\n').find((line) => line.startsWith('Result:'));
    expect(matrixed.stdout).toContain(resultLine as string);
  });

  it('does not change JSON output, which is already machine-shaped', async () => {
    const plain = await invoke(['check', V1, '--targets', 'openai', '--format', 'json']);
    const matrixed = await invoke(['check', V1, '--targets', 'openai', '--matrix', '--format', 'json']);

    expect(matrixed.stdout).toBe(plain.stdout);
  });

  it('does not swallow a load error', async () => {
    // An empty directory never reaches the printer — it is an input error, and
    // `--matrix` must not change that.
    const dir = tempDir();
    writeFile(dir, 'tools/.keep', '');
    const { code, stderr } = await invoke(['check', 'tools', '--matrix'], { cwd: dir });

    expect(code).toBe(2);
    expect(stderr).toContain('no .json tool definitions');
  });
});
