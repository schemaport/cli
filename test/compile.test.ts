import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Manifest } from '../src/index.js';
import { V1, cleanupTempDirs, invoke, parseJson, tempDir } from './helpers.js';
import { compatibleProvider, lossyProvider } from './fakes.js';

afterAll(cleanupTempDirs);

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
}

/** Every file under `dir`, as forward-slash paths relative to it, sorted. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return found.sort();
}

describe('compile output layout', () => {
  it('writes <out>/<target>/<tool>.json plus a manifest', async () => {
    const out = tempDir();
    const { code } = await invoke(['compile', V1, '--out', out, '--targets', 'gemini,mcp']);

    expect(code).toBe(0);
    expect(filesUnder(out)).toEqual([
      'gemini/refund-order.json',
      'gemini/search-orders.json',
      'manifest.json',
      'mcp/refund-order.json',
      'mcp/search-orders.json',
    ]);
  });

  it('writes files whose contents are valid JSON', async () => {
    const out = tempDir();
    await invoke(['compile', V1, '--out', out, '--targets', 'mcp']);
    const raw = readFileSync(join(out, 'mcp', 'refund-order.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('produces a manifest with the documented shape', async () => {
    const out = tempDir();
    await invoke(['compile', V1, '--out', out]);
    const manifest = readManifest(out);

    expect(manifest.schemaPortVersion).toBe('0.1.0');
    expect(manifest.targets).toEqual(['anthropic', 'gemini', 'mcp', 'openai']);
    expect(manifest.tools.map((tool) => tool.name)).toEqual(['refund_order', 'search_orders']);

    const refund = manifest.tools[0];
    expect(refund?.source).toBe('examples/refund-order/v1/refund-order.json');
    expect(Object.keys(refund?.targets ?? {})).toEqual(['anthropic', 'gemini', 'mcp', 'openai']);

    const openai = refund?.targets['openai'];
    expect(openai?.output).toBe('openai/refund-order.json');
    expect(existsSync(join(out, openai?.output ?? ''))).toBe(true);
    expect(Array.isArray(openai?.transformations)).toBe(true);
    expect(Array.isArray(openai?.warnings)).toBe(true);

    for (const item of openai?.transformations ?? []) {
      expect(Object.keys(item).sort()).toEqual(['code', 'detail', 'lossy', 'path']);
    }
    for (const warning of openai?.warnings ?? []) {
      expect(Object.keys(warning).sort()).toEqual(['code', 'message', 'path']);
    }
  });

  it('contains no timestamp and is byte-identical across runs', async () => {
    const first = tempDir();
    const second = tempDir();

    await invoke(['compile', V1, '--out', first]);
    await invoke(['compile', V1, '--out', second]);

    const files = filesUnder(first);
    expect(files).toEqual(filesUnder(second));
    expect(files.length).toBeGreaterThan(1);

    for (const file of files) {
      expect(readFileSync(join(first, file), 'utf8')).toBe(readFileSync(join(second, file), 'utf8'));
    }
  });

  it('emits a JSON document carrying the manifest', async () => {
    const out = tempDir();
    const { stdout } = await invoke(['compile', V1, '--out', out, '--format', 'json', '--targets', 'mcp']);
    const document = parseJson(stdout);

    expect(document['command']).toBe('compile');
    expect(document['schemaPortVersion']).toBe('0.1.0');
    expect(Object.keys(document['summary'] as object).sort()).toEqual([
      'refused',
      'tools',
      'written',
    ]);
    expect((document['summary'] as Record<string, number>)['written']).toBe(2);
    expect(document['out']).toBe(out);
    expect((document['manifest'] as Manifest).targets).toEqual(['mcp']);
  });
});

describe('lossy refusal', () => {
  it('refuses, writes nothing for that target, and exits 1', async () => {
    const out = tempDir();
    const { code, stdout } = await invoke(['compile', V1, '--out', out], {
      providers: [compatibleProvider(), lossyProvider()],
    });

    expect(code).toBe(1);
    expect(stdout).toContain('Refused. Nothing was written for this target.');
    expect(stdout).toContain('--allow-lossy');
    expect(stdout).toContain('dropped-minimum');

    expect(filesUnder(out)).toEqual([
      'manifest.json',
      'openai/refund-order.json',
      'openai/search-orders.json',
    ]);

    const manifest = readManifest(out);
    expect(manifest.targets).toEqual(['gemini', 'openai']);
    expect(Object.keys(manifest.tools[0]?.targets ?? {})).toEqual(['openai']);
  });

  it('writes the output once --allow-lossy is passed', async () => {
    const out = tempDir();
    const { code } = await invoke(['compile', V1, '--out', out, '--allow-lossy'], {
      providers: [lossyProvider()],
    });

    expect(code).toBe(0);
    expect(filesUnder(out)).toEqual([
      'gemini/refund-order.json',
      'gemini/search-orders.json',
      'manifest.json',
    ]);

    const entry = readManifest(out).tools[0]?.targets['gemini'];
    expect(entry?.transformations.some((item) => item.lossy)).toBe(true);
  });
});
