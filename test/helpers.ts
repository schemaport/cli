import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunIO } from '../src/index.js';
import { run } from '../src/index.js';

/** The CLI package root — `examples/` lives here. */
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const V1 = 'examples/refund-order/v1';
export const V2 = 'examples/refund-order/v2';
export const REFUND_V1 = `${V1}/refund-order.json`;

export interface Invocation {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the CLI in-process and capture everything it produced.
 *
 * No child process and no real stdout, so every assertion is on the same
 * strings a user would see, minus colour (there is no TTY here).
 */
export async function invoke(argv: string[], io: Partial<RunIO> = {}): Promise<Invocation> {
  let stdout = '';
  let stderr = '';

  const code = await run(argv, {
    cwd: REPO_ROOT,
    isTTY: false,
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
    ...io,
  });

  return { code, stdout, stderr };
}

/** Parse the single JSON document a `--format json` run prints. */
export function parseJson(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

const temporaryDirectories: string[] = [];

/** A temp directory removed by {@link cleanupTempDirs}. */
export function tempDir(prefix = 'schemaport-cli-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of temporaryDirectories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write a file inside `dir`, creating parent directories as needed. */
export function writeFile(dir: string, relativePath: string, contents: string): string {
  const file = join(dir, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents, 'utf8');
  return file;
}

/** A tool every provider can represent, used where the exit code must be 0. */
export const TRIVIAL_TOOL = {
  name: 'noop_tool',
  description: 'Does nothing',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

/** Not a valid canonical tool: `inputSchema` must be an object schema. */
export const MALFORMED_TOOL = {
  name: 'bad_tool',
  inputSchema: { type: 'string' },
};
