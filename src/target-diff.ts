/**
 * Per-target compatibility analysis for `diff`.
 *
 * `diffToolSets` answers one question: would a caller written against the old
 * schema still work? That question is provider-independent, and it is the right
 * default — but it is not the only way a schema change can hurt.
 *
 * A change can be perfectly safe canonically and still stop compiling for a
 * target. Adding an *optional* property is textbook non-breaking — a canonical
 * diff reports `0 breaking` — but if that property uses `oneOf`, OpenAI can
 * only express it by widening to `anyOf`, which is lossy, and the tool stops
 * compiling. The schema got safer for callers and unshippable for a provider,
 * and nothing in a canonical diff sees it.
 *
 * This module compiles both sides against each requested target and reports
 * what changed about compatibility rather than about the schema.
 */

import type { CanonicalTool, CompileResult, Diagnostic, SchemaPortProvider } from '@schemaport/core';
import { compareStrings } from '@schemaport/core';

/** What happened to one tool's compatibility with one target. */
export type TargetVerdict = 'regressed' | 'fixed' | 'unchanged';

export interface DiagnosticRef {
  code: string;
  path: string;
  severity: Diagnostic['severity'];
}

/** One reason compilation is refused, at the place responsible for it. */
export interface RefusalCause {
  code: string;
  path: string;
}

/**
 * `finalizeCompile` collapses every lossy transformation into this one error.
 * It is accurate and useless on its own — the actionable information is which
 * transformation was lossy and where, so it is unwrapped rather than reported.
 */
const LOSSY_REFUSAL = 'core/lossy-transformation-refused';

export interface TargetToolChange {
  toolName: string;
  verdict: TargetVerdict;
  /** Compiled cleanly before the change. */
  before: boolean;
  /** Compiles cleanly after it. */
  after: boolean;
  /** Why compilation is refused now, when it is. */
  refusedBy: readonly RefusalCause[];
  /** Diagnostics present after but not before. */
  added: readonly DiagnosticRef[];
  /** Diagnostics present before but not after. */
  resolved: readonly DiagnosticRef[];
}

export interface TargetReport {
  targetId: string;
  displayName: string;
  regressed: number;
  fixed: number;
  tools: readonly TargetToolChange[];
}

export interface TargetDiffResult {
  reports: readonly TargetReport[];
  /** Tools that compiled before and do not compile now, across all targets. */
  regressions: number;
}

/**
 * Compare compatibility across targets for every tool present on both sides.
 *
 * Added and removed tools are deliberately skipped: a canonical diff already
 * reports them, and "a tool that did not exist yet does not compile" is not a
 * regression.
 *
 * Compilation is attempted without `allowLossy`, because that is the question
 * being asked — would this still ship? A tool that only compiles by discarding
 * constraints has not stayed compatible.
 */
export function diffTargets(
  before: readonly CanonicalTool[],
  after: readonly CanonicalTool[],
  providers: readonly SchemaPortProvider[],
): TargetDiffResult {
  const beforeByName = new Map(before.map((tool) => [tool.name, tool]));
  const shared = after
    .filter((tool) => beforeByName.has(tool.name))
    .sort((a, b) => compareStrings(a.name, b.name));

  const reports: TargetReport[] = [];
  let regressions = 0;

  for (const provider of providers) {
    const tools: TargetToolChange[] = [];

    for (const tool of shared) {
      const previous = beforeByName.get(tool.name) as CanonicalTool;
      const change = compareOne(provider, previous, tool);
      const quiet =
        change.verdict === 'unchanged' && change.added.length === 0 && change.resolved.length === 0;
      if (!quiet) tools.push(change);
    }

    const regressed = tools.filter((tool) => tool.verdict === 'regressed').length;
    regressions += regressed;
    reports.push({
      targetId: provider.id,
      displayName: provider.displayName,
      regressed,
      fixed: tools.filter((tool) => tool.verdict === 'fixed').length,
      tools,
    });
  }

  return { reports, regressions };
}

function compareOne(
  provider: SchemaPortProvider,
  before: CanonicalTool,
  after: CanonicalTool,
): TargetToolChange {
  const previous = safeCompile(provider, before);
  const current = safeCompile(provider, after);

  const beforeCodes = new Map(previous.diagnostics.map((entry) => [key(entry), entry]));
  const afterCodes = new Map(current.diagnostics.map((entry) => [key(entry), entry]));

  const added = [...afterCodes.entries()]
    .filter(([id]) => !beforeCodes.has(id))
    .map(([, entry]) => ref(entry));
  const resolved = [...beforeCodes.entries()]
    .filter(([id]) => !afterCodes.has(id))
    .map(([, entry]) => ref(entry));

  let verdict: TargetVerdict = 'unchanged';
  if (previous.ok && !current.ok) verdict = 'regressed';
  else if (!previous.ok && current.ok) verdict = 'fixed';

  const refusedBy = current.ok ? [] : refusalCauses(current);

  return {
    toolName: after.name,
    verdict,
    before: previous.ok,
    after: current.ok,
    refusedBy,
    added: sortRefs(added),
    resolved: sortRefs(resolved),
  };
}

/**
 * A provider adapter is third-party code. A diff that dies because one adapter
 * threw on one tool is worse than a diff that reports that tool as refused, so
 * a throw becomes a refusal carrying the message.
 */
function safeCompile(provider: SchemaPortProvider, tool: CanonicalTool): CompileResult {
  try {
    return provider.compile(tool);
  } catch (error) {
    return {
      providerId: provider.id,
      toolName: tool.name,
      ok: false,
      transformations: [],
      diagnostics: [
        {
          providerId: provider.id,
          toolName: tool.name,
          severity: 'error',
          code: `${provider.id}/adapter-threw`,
          message: `The ${provider.displayName} adapter threw while compiling: ${messageOf(error)}`,
          path: 'inputSchema',
          compile: { supported: false, lossy: false, detail: 'The adapter threw.' },
        },
      ],
    };
  }
}

/**
 * Why a refused compile was refused, in terms the reader can act on.
 *
 * The generic lossy refusal is unwrapped into the transformations that caused
 * it: "converted-one-of-to-any-of at inputSchema.properties.assignee.oneOf"
 * points at the change to make, where "lossy-transformation-refused at
 * inputSchema" points at the whole tool.
 */
function refusalCauses(result: CompileResult): RefusalCause[] {
  const causes: RefusalCause[] = [];

  for (const entry of result.diagnostics) {
    if (entry.severity !== 'error' || entry.code === LOSSY_REFUSAL) continue;
    causes.push({ code: entry.code, path: entry.path });
  }
  for (const change of result.transformations) {
    if (change.lossy) causes.push({ code: change.code, path: change.path });
  }

  return causes.sort((a, b) => compareStrings(a.path, b.path) || compareStrings(a.code, b.code));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Diagnostics are identified by code and path: the same rule can fire twice. */
function key(diagnostic: Diagnostic): string {
  return `${diagnostic.code} ${diagnostic.path}`;
}

function ref(diagnostic: Diagnostic): DiagnosticRef {
  return { code: diagnostic.code, path: diagnostic.path, severity: diagnostic.severity };
}

function sortRefs(refs: DiagnosticRef[]): DiagnosticRef[] {
  return [...refs].sort((a, b) => compareStrings(a.path, b.path) || compareStrings(a.code, b.code));
}
