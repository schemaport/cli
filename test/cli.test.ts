import { afterAll, describe, expect, it } from 'vitest';
import { CLI_VERSION } from '../src/index.js';
import {
  MALFORMED_TOOL,
  REFUND_V1,
  V1,
  cleanupTempDirs,
  invoke,
  parseJson,
  tempDir,
  writeFile,
} from './helpers.js';

afterAll(cleanupTempDirs);

describe('help and version', () => {
  it('prints general help with no arguments', async () => {
    const { code, stdout } = await invoke([]);
    expect(code).toBe(0);
    for (const command of ['check', 'compile', 'probe', 'diff']) {
      expect(stdout).toContain(`schemaport ${command}`);
    }
    expect(stdout).toContain('Exit codes:');
  });

  it('prints per-command help', async () => {
    const { code, stdout } = await invoke(['compile', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('schemaport compile <path...> --out <dir>');
    expect(stdout).toContain('--allow-lossy');
  });

  it('prints the version', async () => {
    const { code, stdout } = await invoke(['--version']);
    expect(code).toBe(0);
    expect(stdout).toContain(`schemaport ${CLI_VERSION}`);
    expect(stdout).toContain('@schemaport/core');
  });
});

describe('usage errors exit 2', () => {
  it('rejects an unknown command', async () => {
    const { code, stderr } = await invoke(['lint', V1]);
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown command `lint`');
  });

  it('rejects an unknown flag', async () => {
    const { code, stderr } = await invoke(['check', V1, '--strict']);
    expect(code).toBe(2);
    expect(stderr).toContain('--strict');
  });

  it('rejects an unknown target and lists the valid ids', async () => {
    const { code, stderr } = await invoke(['check', V1, '--targets', 'openai,bedrock']);
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown target `bedrock`');
    expect(stderr).toContain('openai, anthropic, gemini, mcp');
  });

  it('rejects an unknown --format', async () => {
    const { code, stderr } = await invoke(['check', V1, '--format', 'yaml']);
    expect(code).toBe(2);
    expect(stderr).toContain('Valid formats are: text, json');
  });

  it('rejects an unknown --fail-on', async () => {
    const { code, stderr } = await invoke(['check', V1, '--fail-on', 'anything']);
    expect(code).toBe(2);
    expect(stderr).toContain('Valid values are: error, warning, never');
  });

  it('reports a usage error as JSON when --format json was asked for', async () => {
    const { code, stdout, stderr } = await invoke(['check', V1, '--targets', 'nope', '--format', 'json']);
    expect(code).toBe(2);
    expect(stderr).toBe('');
    const document = parseJson(stdout);
    expect(document['command']).toBe('check');
    expect(document['schemaPortVersion']).toBe('0.1.0');
    expect(Array.isArray(document['errors'])).toBe(true);
  });

  it('rejects a path that does not exist', async () => {
    const { code, stderr } = await invoke(['check', 'examples/does-not-exist']);
    expect(code).toBe(2);
    expect(stderr).toContain('Path does not exist.');
  });

  it('rejects a malformed canonical schema', async () => {
    const dir = tempDir();
    writeFile(dir, 'tools/bad.json', JSON.stringify(MALFORMED_TOOL));
    const { code, stderr } = await invoke(['check', 'tools'], { cwd: dir });
    expect(code).toBe(2);
    expect(stderr).toContain('inputSchema');
  });

  it('reports load errors as JSON and exits 2', async () => {
    const dir = tempDir();
    writeFile(dir, 'tools/bad.json', '{ not json');
    const { code, stdout } = await invoke(['check', 'tools', '--format', 'json'], { cwd: dir });
    expect(code).toBe(2);
    const document = parseJson(stdout);
    expect(document['command']).toBe('check');
    const errors = document['errors'] as { sourcePath: string; message: string }[];
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain('Invalid JSON');
  });

  it('requires --out for compile', async () => {
    const { code, stderr } = await invoke(['compile', V1]);
    expect(code).toBe(2);
    expect(stderr).toContain('--out');
  });

  it('requires exactly two paths for diff', async () => {
    const { code, stderr } = await invoke(['diff', V1]);
    expect(code).toBe(2);
    expect(stderr).toContain('exactly two paths');
  });

  it('does not accept --targets on diff', async () => {
    const { code } = await invoke(['diff', V1, V1, '--targets', 'openai']);
    expect(code).toBe(2);
  });

  it('requires an input path when no config supplies one', async () => {
    const dir = tempDir();
    const { code, stderr } = await invoke(['check'], { cwd: dir });
    expect(code).toBe(2);
    expect(stderr).toContain('No input path given');
  });
});

describe('output discipline', () => {
  it('writes nothing but one JSON document to stdout', async () => {
    const { stdout } = await invoke(['check', REFUND_V1, '--format', 'json']);
    expect(() => parseJson(stdout)).not.toThrow();
    expect(stdout.trimEnd().endsWith('}')).toBe(true);
  });

  it('never colours output when stdout is not a TTY', async () => {
    const { stdout } = await invoke(['check', REFUND_V1, '--fail-on', 'never']);
    expect(stdout.includes('\u001B[')).toBe(false);
  });

  it('never colours JSON, even on a TTY', async () => {
    const { stdout } = await invoke(['check', REFUND_V1, '--format', 'json'], { isTTY: true });
    expect(() => parseJson(stdout)).not.toThrow();
  });
});
