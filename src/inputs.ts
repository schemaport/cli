import { isAbsolute, resolve, sep } from 'node:path';
import type { LoadError, LoadedTool } from '@schemaport/core';
import { displayPath, loadTools } from '@schemaport/core';
import { UsageError } from './errors.js';

export interface LoadedInput {
  tools: LoadedTool[];
  errors: LoadError[];
}

/**
 * Load every path given on the command line into one tool set.
 *
 * Paths are resolved against the run's working directory rather than
 * `process.cwd()` so tests can point the CLI at a temp directory.
 */
export function loadInputs(paths: readonly string[], cwd: string): LoadedInput {
  if (paths.length === 0) {
    throw new UsageError(
      'No input path given. Pass a file or directory, or set `schemas` in schemaport.config.json.',
    );
  }

  const tools: LoadedTool[] = [];
  const errors: LoadError[] = [];

  for (const path of paths) {
    const result = loadTools(absolute(path, cwd));
    tools.push(...result.tools);
    errors.push(...result.errors);
  }

  // `loadTools` de-duplicates within a single path; names must also be unique
  // across the paths given on one command line.
  const seen = new Map<string, string>();
  for (const loaded of tools) {
    const previous = seen.get(loaded.tool.name);
    if (previous !== undefined && previous !== loaded.sourcePath) {
      errors.push({
        sourcePath: loaded.sourcePath,
        message: `Duplicate tool name \`${loaded.tool.name}\`, already defined in ${previous}.`,
      });
    } else {
      seen.set(loaded.tool.name, loaded.sourcePath);
    }
  }

  tools.sort((a, b) => a.tool.name.localeCompare(b.tool.name));
  return { tools, errors };
}

/** Resolve a user-supplied path against the run's working directory. */
export function absolute(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/**
 * Present a path the way the user would type it, always with forward slashes.
 *
 * Paths outside the working directory are shown absolute: `../../../../tmp/out`
 * is technically correct and completely unreadable.
 */
export function relativeToCwd(path: string, cwd: string): string {
  const shown = displayPath(path, cwd);
  return shown.startsWith('..') ? path.split(sep).join('/') : shown;
}
