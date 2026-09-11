/**
 * The portability matrix: one row per tool, one column per target.
 *
 * `check` prints a block per tool per target. At four targets that is four
 * blocks a tool, and a forty-tool set produces a hundred and sixty of them —
 * enough that the question the product exists to answer, *is my tool set
 * portable?*, gets lost in the output that answers it.
 *
 * The matrix is a rendering of exactly the same diagnostics, not a second
 * analysis. Every cell is the worst severity that target reported for that
 * tool, which is the same rollup `--quiet` prints per target.
 *
 * It deliberately does not say whether a tool would *compile*. An error here
 * can be one compilation repairs — `openai/strict-optional-property` is an
 * error and compile fixes it. "Would this ship?" is a different question, and
 * `compile` and `diff --targets` are the commands that answer it.
 */

import type { Diagnostic } from '@schemaport/core';
import { countBySeverity } from '@schemaport/core';
import type { Context } from './io.js';
import { MARK } from './io.js';

/** One tool's findings against one target. */
export interface MatrixCell {
  targetId: string;
  severity: Diagnostic['severity'] | 'clean';
}

export interface MatrixRow {
  toolName: string;
  cells: readonly MatrixCell[];
}

export interface Matrix {
  targets: readonly { id: string; displayName: string }[];
  rows: readonly MatrixRow[];
  /** Tools with no findings at all for each target, keyed by target id. */
  cleanByTarget: Readonly<Record<string, number>>;
}

interface MatrixSource {
  toolName: string;
  perTarget: readonly { id: string; displayName: string; diagnostics: readonly Diagnostic[] }[];
}

/** Build the matrix from the per-tool, per-target diagnostics `check` already has. */
export function buildMatrix(results: readonly MatrixSource[]): Matrix {
  const targets: { id: string; displayName: string }[] = [];
  for (const target of results[0]?.perTarget ?? []) {
    targets.push({ id: target.id, displayName: target.displayName });
  }

  const cleanByTarget: Record<string, number> = {};
  for (const target of targets) cleanByTarget[target.id] = 0;

  const rows = results.map((result) => ({
    toolName: result.toolName,
    cells: result.perTarget.map((target) => {
      const severity = worst(target.diagnostics);
      if (severity === 'clean') cleanByTarget[target.id] = (cleanByTarget[target.id] ?? 0) + 1;
      return { targetId: target.id, severity };
    }),
  }));

  return { targets, rows, cleanByTarget };
}

function worst(diagnostics: readonly Diagnostic[]): MatrixCell['severity'] {
  if (diagnostics.length === 0) return 'clean';
  const counts = countBySeverity(diagnostics);
  if (counts.error > 0) return 'error';
  if (counts.warning > 0) return 'warning';
  return 'info';
}

/**
 * Cell markers, chosen for width rather than for consistency with the listing.
 *
 * The listing uses `⚠` and `ℹ`, and both default to *emoji* presentation: a
 * terminal renders them two columns wide while `String.length` reports one.
 * In running prose that is invisible, because nothing is aligned after them.
 * In a table every column to the right shifts, and the shift differs per
 * terminal, so no amount of padding fixes it. Requesting text presentation
 * with VARIATION SELECTOR-15 does not help either — terminals that ignore it
 * print the selector as a stray glyph, which is worse than the misalignment.
 *
 * `✓` and `✗` are kept: they carry the most meaning and, having no emoji form,
 * are one column everywhere. The other two become ASCII.
 */
const CELL: Record<MatrixCell['severity'], string> = {
  clean: MARK.ok,
  info: 'i',
  warning: '!',
  error: MARK.error,
};

/** Spelled out under the table, since two of the four are not the usual glyphs. */
const LEGEND = `${MARK.ok} clean   ! warning   ${MARK.error} error   i info`;

/**
 * Render the matrix.
 *
 * Column widths are measured from the content, so a long tool name or an
 * unfamiliar target from an injected registry does not break the alignment.
 * Every marker is one column wide by construction (see {@link CELL}), which is
 * what lets a cell be centred by padding around a single character.
 */
export function printMatrix(ctx: Context, matrix: Matrix, toolCount: number): void {
  if (matrix.rows.length === 0) {
    ctx.out.line('No tools found.');
    return;
  }

  const nameWidth = Math.max(...matrix.rows.map((row) => row.toolName.length), 'Tool'.length);
  const widths = matrix.targets.map((target) => Math.max(target.displayName.length, 3));

  const header = matrix.targets
    .map((target, index) => target.displayName.padEnd(widths[index] as number))
    .join('  ');
  ctx.out.line(`${ctx.out.bold('Tool'.padEnd(nameWidth))}  ${ctx.out.bold(header)}`.trimEnd());

  for (const row of matrix.rows) {
    const cells = row.cells
      .map((cell, index) => centre(ctx, cell.severity, widths[index] as number))
      .join('  ');
    // Trailing pad on the last column is invisible but shows up in a diff of
    // captured output, and in a test asserting an exact line.
    ctx.out.line(`${row.toolName.padEnd(nameWidth)}  ${cells}`.trimEnd());
  }

  ctx.out.line();
  ctx.out.line(ctx.out.dim(LEGEND));
  const clean = matrix.targets.map((target) => {
    const count = matrix.cleanByTarget[target.id] ?? 0;
    return `${target.displayName} ${String(count)}/${String(toolCount)}`;
  });
  ctx.out.line(`Clean: ${clean.join(' · ')}`);
}

/**
 * Centre a one-column marker in a field, colouring it after padding.
 *
 * Colour codes are zero-width on screen but not to `padStart`, so the pad has
 * to be computed on the bare glyph.
 */
function centre(ctx: Context, severity: MatrixCell['severity'], width: number): string {
  const glyph = CELL[severity];
  const left = Math.floor((width - 1) / 2);
  const right = width - 1 - left;
  return `${' '.repeat(left)}${colour(ctx, severity, glyph)}${' '.repeat(right)}`;
}

function colour(ctx: Context, severity: MatrixCell['severity'], glyph: string): string {
  switch (severity) {
    case 'clean':
      return ctx.out.green(glyph);
    case 'error':
      return ctx.out.red(glyph);
    case 'warning':
      return ctx.out.yellow(glyph);
    case 'info':
      return ctx.out.dim(glyph);
  }
}
