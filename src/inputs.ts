import { isAbsolute, resolve, sep } from 'node:path';
import type { LoadError, LoadedTool } from '@schemaport/core';
import { displayPath, loadTools, compareStrings} from '@schemaport/core';
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

  // The first path to define each name. Only ever holds one entry per name, so
  // a name repeated inside one path cannot collide with itself here.
  const seen = new Map<string, string>();

  for (const path of paths) {
    const result = loadTools(absolute(path, cwd));
    tools.push(...result.tools);
    errors.push(...result.errors);

    // `loadTools` already reports every name repeated inside this one path, and
    // those errors are in `result.errors` above. Re-scanning the merged list
    // would report each of them a second time, so only the first definition of
    // a name within this path is compared against the paths already loaded.
    const definedHere = new Map<string, string>();
    for (const loaded of result.tools) {
      if (!definedHere.has(loaded.tool.name)) {
        definedHere.set(loaded.tool.name, loaded.sourcePath);
      }
    }

    // Names must also be unique across the paths given on one command line.
    for (const [name, sourcePath] of definedHere) {
      const previous = seen.get(name);
      if (previous === undefined) {
        seen.set(name, sourcePath);
      } else if (previous !== sourcePath) {
        errors.push({
          sourcePath,
          message: `Duplicate tool name \`${name}\`, already defined in ${previous}.`,
        });
      }
    }
  }

  tools.sort((a, b) => compareStrings(a.tool.name, b.tool.name));
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
