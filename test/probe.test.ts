import { afterAll, describe, expect, it } from 'vitest';
import { REFUND_V1, cleanupTempDirs, invoke, parseJson } from './helpers.js';
import { ACCEPTED, MISSING_KEY, REJECTED, compatibleProvider, probingProvider } from './fakes.js';

afterAll(cleanupTempDirs);

/**
 * Every probe test drives fake providers, or a target that cannot make a
 * request. Nothing here touches the network and no API key is ever set.
 */
describe('probe', () => {
  it('exits 3 and names the environment variable when credentials are missing', async () => {
    const { code, stdout } = await invoke(['probe', REFUND_V1], {
      providers: [probingProvider(MISSING_KEY)],
    });

    expect(code).toBe(3);
    expect(stdout).toContain('OPENAI_API_KEY');
    expect(stdout).toContain('export OPENAI_API_KEY=<your key>');
    expect(stdout).toContain(`schemaport probe ${REFUND_V1}`);
    expect(stdout).toContain('not a schema rejection');
    expect(stdout).not.toContain('REJECTED');
  });

  it('reports a missing key as an error, never as a rejection, in JSON too', async () => {
    const { code, stdout } = await invoke(['probe', REFUND_V1, '--format', 'json'], {
      providers: [probingProvider(MISSING_KEY)],
    });

    expect(code).toBe(3);
    const document = parseJson(stdout);
    expect(document['command']).toBe('probe');
    const summary = document['summary'] as Record<string, number>;
    expect(Object.keys(summary).sort()).toEqual(['accepted', 'errors', 'rejected', 'skipped']);
    expect(summary['rejected']).toBe(0);
    expect(summary['errors']).toBe(1);

    const results = document['results'] as Record<string, unknown>[];
    expect(results[0]?.['source']).toBe(REFUND_V1);
    expect(results[0]?.['status']).toBe('error');
    expect(results[0]?.['errorKind']).toBe('missing-credentials');
    expect(results[0]?.['schemaAccepted']).toBe(false);
  });

  it('exits 1 when a provider rejects the schema, printing its message verbatim', async () => {
    const { code, stdout } = await invoke(['probe', REFUND_V1], {
      providers: [probingProvider(REJECTED)],
    });

    expect(code).toBe(1);
    expect(stdout).toContain('REJECTED (model: fake-model-1)');
    expect(stdout).toContain('Invalid schema for function: expected an object.');
    expect(stdout).toContain('Result: 0 accepted, 1 rejected');
  });

  it('exits 0 when every probe is accepted', async () => {
    const { code, stdout } = await invoke(['probe', REFUND_V1], {
      providers: [probingProvider(ACCEPTED)],
    });

    expect(code).toBe(0);
    expect(stdout).toContain('✓ ACCEPTED (model: fake-model-1)');
  });

  it('prefers exit 1 when there is both a rejection and an environment error', async () => {
    const { code } = await invoke(['probe', REFUND_V1, '--targets', 'openai,anthropic'], {
      providers: [
        probingProvider(REJECTED, 'openai', 'Fake OpenAI'),
        probingProvider(MISSING_KEY, 'anthropic', 'Fake Anthropic'),
      ],
    });
    expect(code).toBe(1);
  });

  it('skips a target with no probe support instead of failing', async () => {
    const { code, stdout } = await invoke(['probe', REFUND_V1, '--targets', 'mcp'], {
      providers: [compatibleProvider('mcp', 'Fake MCP')],
    });

    expect(code).toBe(0);
    expect(stdout).toContain('SKIPPED');
    expect(stdout).toContain('Result: 0 accepted, 0 rejected, 0 errors, 1 skipped');
  });

  it('defaults to the hosted targets and leaves MCP out', async () => {
    const { stdout } = await invoke(['probe', REFUND_V1, '--format', 'json'], {
      providers: [
        probingProvider(MISSING_KEY, 'openai', 'Fake OpenAI'),
        probingProvider(MISSING_KEY, 'anthropic', 'Fake Anthropic'),
        probingProvider(MISSING_KEY, 'gemini', 'Fake Gemini'),
        compatibleProvider('mcp', 'Fake MCP'),
      ],
    });

    const results = parseJson(stdout)['results'] as { providerId: string }[];
    expect(results.map((result) => result.providerId)).toEqual(['openai', 'anthropic', 'gemini']);
  });

  it('probes the real MCP target without any network access', async () => {
    const { code, stdout } = await invoke(['probe', REFUND_V1, '--targets', 'mcp']);
    expect(code).toBe(0);
    expect(stdout).toContain('SKIPPED');
  });
});
