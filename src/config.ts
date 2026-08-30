import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { CheckFailOn } from './args.js';
import { UsageError } from './errors.js';

export const CONFIG_FILE_NAME = 'schemaport.config.json';

/**
 * `schemaport.config.json`.
 *
 * Deliberately tiny and JSON-only: no TypeScript config loader, no plugin
 * resolution. Command-line arguments always win over these values.
 */
export interface SchemaPortConfig {
  /** Default input path used when no path is given on the command line. */
  schemas?: string;
  /** Default `--targets`. */
  targets?: string[];
  /** Default `--out` for `compile`. */
  output?: string;
  /** Default `--allow-lossy`. */
  allowLossy?: boolean;
  /** Default `check --quiet`. */
  quiet?: boolean;
  /** Default `check --fail-on`. */
  failOn?: CheckFailOn;
}

export interface LoadedConfig {
  config: SchemaPortConfig;
  /** Absolute path the config came from, or `undefined` when none was found. */
  path?: string;
}

const KNOWN_KEYS = new Set(['schemas', 'targets', 'output', 'allowLossy', 'quiet', 'failOn']);

/**
 * Load the config file.
 *
 * An explicit `--config` that does not exist is a usage error. A missing
 * `schemaport.config.json` in the working directory is not — the file is
 * optional by design.
 */
export function loadConfig(explicitPath: string | undefined, cwd: string): LoadedConfig {
  const path =
    explicitPath === undefined
      ? defaultConfigPath(cwd)
      : isAbsolute(explicitPath)
        ? explicitPath
        : resolve(cwd, explicitPath);

  if (path === undefined) return { config: {} };

  if (explicitPath !== undefined && !isReadableFile(path)) {
    throw new UsageError(`Config file not found: ${explicitPath}`);
  }

  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    throw new UsageError(`Could not read config file ${path}: ${messageOf(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(`Config file ${path} is not valid JSON: ${messageOf(error)}`);
  }

  return { config: validateConfig(parsed, path), path };
}

function defaultConfigPath(cwd: string): string | undefined {
  const candidate = resolve(cwd, CONFIG_FILE_NAME);
  return isReadableFile(candidate) ? candidate : undefined;
}

function isReadableFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function validateConfig(value: unknown, path: string): SchemaPortConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new UsageError(`Config file ${path} must contain a JSON object.`);
  }

  const record = value as Record<string, unknown>;
  const config: SchemaPortConfig = {};

  for (const key of Object.keys(record)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new UsageError(
        `Unknown key \`${key}\` in ${path}. Valid keys are: schemas, targets, output, allowLossy, quiet, failOn.`,
      );
    }
  }

  if (record['schemas'] !== undefined) {
    if (typeof record['schemas'] !== 'string') {
      throw new UsageError(`\`schemas\` in ${path} must be a string.`);
    }
    config.schemas = record['schemas'];
  }

  if (record['targets'] !== undefined) {
    const targets = record['targets'];
    if (!Array.isArray(targets) || targets.some((item) => typeof item !== 'string')) {
      throw new UsageError(`\`targets\` in ${path} must be an array of target ids.`);
    }
    config.targets = targets as string[];
  }

  if (record['output'] !== undefined) {
    if (typeof record['output'] !== 'string') {
      throw new UsageError(`\`output\` in ${path} must be a string.`);
    }
    config.output = record['output'];
  }

  if (record['allowLossy'] !== undefined) {
    if (typeof record['allowLossy'] !== 'boolean') {
      throw new UsageError(`\`allowLossy\` in ${path} must be a boolean.`);
    }
    config.allowLossy = record['allowLossy'];
  }

  if (record['quiet'] !== undefined) {
    if (typeof record['quiet'] !== 'boolean') {
      throw new UsageError(`\`quiet\` in ${path} must be a boolean.`);
    }
    config.quiet = record['quiet'];
  }

  if (record['failOn'] !== undefined) {
    if (
      record['failOn'] !== 'error' &&
      record['failOn'] !== 'warning' &&
      record['failOn'] !== 'never'
    ) {
      throw new UsageError(`\`failOn\` in ${path} must be error, warning, or never.`);
    }
    config.failOn = record['failOn'];
  }

  return config;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
