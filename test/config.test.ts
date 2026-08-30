import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Manifest } from '../src/index.js';
import { loadConfig } from '../src/config.js';
import { TRIVIAL_TOOL, cleanupTempDirs, invoke, parseJson, tempDir, writeFile } from './helpers.js';

afterAll(cleanupTempDirs);

/** A project directory with one tool and a config file. */
function project(config: unknown): string {
  const dir = tempDir();
  writeFile(dir, 'tools/noop.json', JSON.stringify(TRIVIAL_TOOL));
  writeFile(dir, 'schemaport.config.json', JSON.stringify(config, null, 2));
  return dir;
}

describe('schemaport.config.json', () => {
  it('supplies schemas and targets when no path or flag is given', async () => {
    const dir = project({ schemas: 'tools', targets: ['mcp'] });
    const { code, stdout } = await invoke(['check', '--format', 'json'], { cwd: dir });

    expect(code).toBe(0);
    const tools = parseJson(stdout)['tools'] as { name: string; targets: object }[];
    expect(tools.map((tool) => tool.name)).toEqual(['noop_tool']);
    expect(Object.keys(tools[0]?.targets ?? {})).toEqual(['mcp']);
  });

  it('is overridden by --targets on the command line', async () => {
    const dir = project({ schemas: 'tools', targets: ['mcp'] });
    const { stdout } = await invoke(['check', '--format', 'json', '--targets', 'gemini'], {
      cwd: dir,
    });

    const tools = parseJson(stdout)['tools'] as { targets: object }[];
    expect(Object.keys(tools[0]?.targets ?? {})).toEqual(['gemini']);
  });

  it('supplies the compile output directory and allowLossy', async () => {
    const dir = project({ schemas: 'tools', targets: ['mcp'], output: 'generated', allowLossy: true });
    const { code } = await invoke(['compile'], { cwd: dir });

    expect(code).toBe(0);
    const manifest = JSON.parse(
      readFileSync(join(dir, 'generated', 'manifest.json'), 'utf8'),
    ) as Manifest;
    expect(manifest.tools[0]?.targets['mcp']?.output).toBe('mcp/noop-tool.json');
  });

  it('supplies quiet check output as a default', () => {
    const dir = project({ schemas: 'tools', quiet: true });

    expect(loadConfig(undefined, dir).config.quiet).toBe(true);
  });

  it('is read from --config when given', async () => {
    const dir = project({ schemas: 'tools', targets: ['mcp'] });
    writeFile(dir, 'other.json', JSON.stringify({ schemas: 'tools', targets: ['gemini'] }));

    const { stdout } = await invoke(['check', '--format', 'json', '--config', 'other.json'], {
      cwd: dir,
    });
    const tools = parseJson(stdout)['tools'] as { targets: object }[];
    expect(Object.keys(tools[0]?.targets ?? {})).toEqual(['gemini']);
  });
});

describe('invalid configuration exits 2', () => {
  it('rejects a --config file that does not exist', async () => {
    const dir = project({ schemas: 'tools' });
    const { code, stderr } = await invoke(['check', '--config', 'missing.json'], { cwd: dir });
    expect(code).toBe(2);
    expect(stderr).toContain('Config file not found');
  });

  it('rejects malformed config JSON', async () => {
    const dir = tempDir();
    writeFile(dir, 'tools/noop.json', JSON.stringify(TRIVIAL_TOOL));
    writeFile(dir, 'schemaport.config.json', '{ "schemas": ');
    const { code, stderr } = await invoke(['check', 'tools'], { cwd: dir });
    expect(code).toBe(2);
    expect(stderr).toContain('not valid JSON');
  });

  it('rejects an unknown config key', async () => {
    const dir = project({ schemas: 'tools', verbose: true });
    const { code, stderr } = await invoke(['check'], { cwd: dir });
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown key `verbose`');
  });

  it('rejects a config value of the wrong type', async () => {
    const dir = project({ schemas: 'tools', targets: 'mcp' });
    const { code, stderr } = await invoke(['check'], { cwd: dir });
    expect(code).toBe(2);
    expect(stderr).toContain('must be an array of target ids');
  });

  it('rejects an unknown target id in the config file', async () => {
    const dir = project({ schemas: 'tools', targets: ['bedrock'] });
    const { code, stderr } = await invoke(['check'], { cwd: dir });
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown target `bedrock`');
  });
});
