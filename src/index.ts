/**
 * `schemaport`
 *
 * The CLI is also a library: `run(argv, io)` does everything the binary does
 * and returns the exit code instead of terminating the process.
 */

export { run } from './run.js';
export type { RunIO } from './io.js';
export type {
  CheckFailOn,
  CommandName,
  DiffFailOn,
  OutputFormat,
  ParsedInvocation,
} from './args.js';
export type { SchemaPortConfig } from './config.js';
export { CONFIG_FILE_NAME } from './config.js';
export { EXIT, UsageError } from './errors.js';
export { helpText } from './help.js';
export {
  ALL_TARGET_IDS,
  ALL_TARGETS_KEYWORD,
  DEFAULT_PROBE_TARGET_IDS,
  DEFAULT_PROVIDERS,
} from './targets.js';
export { CLI_VERSION } from './version.js';
export type {
  Manifest,
  ManifestTargetEntry,
  ManifestTool,
  ManifestWarning,
} from './commands/compile.js';
