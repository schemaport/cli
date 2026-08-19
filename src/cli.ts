#!/usr/bin/env node
import { EXIT } from './errors.js';
import { run } from './run.js';

/**
 * Thin wrapper around `run()`.
 *
 * `process.exitCode` rather than `process.exit()`: exiting immediately can
 * truncate buffered stdout when it is a pipe.
 */
run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`schemaport: ${message}\n`);
    process.exitCode = EXIT.usage;
  });
