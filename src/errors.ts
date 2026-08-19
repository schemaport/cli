/**
 * A problem with how the command was invoked, or with the input it was given.
 *
 * Always exit code 2. Never used for findings — a schema that fails a check is
 * a successful run of the CLI that found something.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export const EXIT = {
  ok: 0,
  findings: 1,
  usage: 2,
  environment: 3,
} as const;
