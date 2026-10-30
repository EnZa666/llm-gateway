import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// Type-only import — erased at runtime, does not trigger the real module load.
import type { ForgeGatewayError as FGE } from '../errors.js';

// ---------------------------------------------------------------------------
// Module mocks (must be called before any dynamic import of the mocked modules)
// ---------------------------------------------------------------------------

jest.unstable_mockModule('ai', () => ({
  generateText: jest.fn(),
  generateObject: jest.fn(),
}));

const mockProviderFactory = jest.fn();
const mockModelInstance: Record<string, unknown> = { _tag: 'MockModel' };
mockProviderFactory.mockReturnValue(mockModelInstance);

jest.unstable_mockModule('@ai-sdk/anthropic', () => ({
  anthropic: mockProviderFactory,
}));

const mockOpenAIFactory = jest.fn();
mockOpenAIFactory.mockReturnValue({ _tag: 'MockOpenAIModel' });

jest.unstable_mockModule('@ai-sdk/openai', () => ({
  openai: mockOpenAIFactory,
}));

// ---------------------------------------------------------------------------
// Dynamic imports (executed after mock setup so Jest intercepts them)
// ---------------------------------------------------------------------------

// Import the mocked 'ai' module and obtain typed Mock handles.
// We cast through `unknown` because the mock types diverge from the SDK
// overloads — this is the Vercel AI SDK boundary cast the plan permits.
const aiModule = await import('ai');
type AnyMock = jest.Mock;
const mockGenerateText = aiModule.generateText as unknown as AnyMock;
const mockGenerateObject = aiModule.generateObject as unknown as AnyMock;

const { LLMGateway } = await import('../llm-gateway.js');
const { ForgeGatewayError } = await import('../errors.js');

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeConfig = (pkg = '@ai-sdk/anthropic', factory = 'anthropic') => ({
  phase_id: 'test-phase',
  runtime_execution: {
    provider_package: pkg,
    provider_factory_method: factory,
    model_identifier: 'test-model',
    settings: { temperature: 0, max_tokens: 1000 },
  },
});

const makeTextResult = (text: string, promptTokens = 100, completionTokens = 50) => ({
  text,
  usage: { promptTokens, completionTokens },
  finishReason: 'stop',
  experimental_providerMetadata: {},
  response: {},
  warnings: [],
  rawCall: {},
});

const makeObjectResult = <T>(obj: T, promptTokens = 80, completionTokens = 40) => ({
  object: obj,
  usage: { promptTokens, completionTokens },
  finishReason: 'stop',
  experimental_providerMetadata: {},
  response: {},
  warnings: [],
  rawCall: {},
});

/** Runs `p` and returns the caught error, or `undefined` if it resolved. */
async function catchError(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return err;
  }
}

function assertGatewayError(err: unknown, code: FGE['errorCode']): asserts err is FGE {
  expect(err).toBeInstanceOf(ForgeGatewayError);
  expect((err as FGE).errorCode).toBe(code);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LLMGateway', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProviderFactory.mockReturnValue(mockModelInstance);
  });

  // T1: executeTextTask happy path
  it('T1: executeTextTask returns GatewayResponseEnvelope<string> with telemetry', async () => {
    mockGenerateText.mockResolvedValueOnce(makeTextResult('Hello world'));
    const gw = new LLMGateway(makeConfig());
    const result = await gw.executeTextTask('rules', 'instructions', 'context');
    expect(result.data).toBe('Hello world');
    expect(result.telemetry.tokensConsumedInput).toBe(100);
    expect(result.telemetry.tokensConsumedOutput).toBe(50);
    expect(result.telemetry.executionDurationMs).toBeGreaterThanOrEqual(0);
  });

  // T2: Dynamic import failure → DYNAMIC_IMPORT_FAILED
  it('T2: invalid provider_package throws DYNAMIC_IMPORT_FAILED', async () => {
    const gw = new LLMGateway(makeConfig('non-existent-package-xyz', 'factory'));
    const err = await catchError(gw.executeTextTask('rules', 'instructions', 'context'));
    assertGatewayError(err, 'DYNAMIC_IMPORT_FAILED');
  });

  // T3: REPLACE compliance rule
  it('T3: REPLACE rule transforms output text', async () => {
    mockGenerateText.mockResolvedValueOnce(makeTextResult('optimize for speed'));
    const gw = new LLMGateway(makeConfig());
    const rules = [
      {
        ruleId: 'r1',
        type: 'REPLACE' as const,
        pattern: /optimize/gi,
        replacementValue: 'optimise',
      },
    ];
    const result = await gw.executeTextTask('rules', 'instructions', 'context', rules);
    expect(result.data).toBe('optimise for speed');
  });

  // T4: REJECT compliance rule throws STATUTORY_RULE_VIOLATION
  it('T4: REJECT rule throws STATUTORY_RULE_VIOLATION when pattern matches', async () => {
    mockGenerateText.mockResolvedValueOnce(makeTextResult('delve into the topic'));
    const gw = new LLMGateway(makeConfig());
    const rules = [{ ruleId: 'no-delve', type: 'REJECT' as const, pattern: /delve/gi }];
    const err = await catchError(gw.executeTextTask('rules', 'instructions', 'context', rules));
    assertGatewayError(err, 'STATUTORY_RULE_VIOLATION');
  });

  // T5: REPLACE runs before REJECT — no violation when REPLACE removes the match
  it('T5: REPLACE before REJECT removes match so no STATUTORY_RULE_VIOLATION', async () => {
    mockGenerateText.mockResolvedValueOnce(makeTextResult('delve into the topic'));
    const gw = new LLMGateway(makeConfig());
    const rules = [
      {
        ruleId: 'replace-delve',
        type: 'REPLACE' as const,
        pattern: /delve/gi,
        replacementValue: 'dive',
      },
      { ruleId: 'reject-delve', type: 'REJECT' as const, pattern: /delve/gi },
    ];
    const result = await gw.executeTextTask('rules', 'instructions', 'context', rules);
    expect(result.data).toBe('dive into the topic');
  });

  // T6: executeStructuredTask happy path
  it('T6: executeStructuredTask returns envelope with validated object', async () => {
    const { z } = await import('zod');
    const schema = z.object({ score: z.number() });
    mockGenerateObject.mockResolvedValueOnce(makeObjectResult({ score: 9 }));
    const gw = new LLMGateway(makeConfig());
    const result = await gw.executeStructuredTask('rules', 'instructions', 'context', schema);
    expect((result.data as { score: number }).score).toBe(9);
  });

  // T7: executeStructuredTask schema mismatch → SCHEMA_VALIDATION_FAILED
  it('T7: generateObject Zod error throws SCHEMA_VALIDATION_FAILED', async () => {
    const { z } = await import('zod');
    const schema = z.object({ score: z.number() });
    const zodError = new Error('zod validation parse error');
    mockGenerateObject.mockRejectedValueOnce(zodError);
    const gw = new LLMGateway(makeConfig());
    const err = await catchError(
      gw.executeStructuredTask('rules', 'instructions', 'context', schema),
    );
    assertGatewayError(err, 'SCHEMA_VALIDATION_FAILED');
  });

  // T8: Telemetry fields are present and valid
  it('T8: telemetry executionDurationMs is non-negative, tokens are non-negative integers', async () => {
    mockGenerateText.mockResolvedValueOnce(makeTextResult('response text', 120, 60));
    const gw = new LLMGateway(makeConfig());
    const result = await gw.executeTextTask('rules', 'instructions', 'context');
    expect(result.telemetry.executionDurationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.telemetry.tokensConsumedInput)).toBe(true);
    expect(result.telemetry.tokensConsumedOutput).toBeGreaterThanOrEqual(0);
  });

  // T9: ForgeGatewayError instanceof check and errorCode validation
  it('T9: ForgeGatewayError is instanceof ForgeGatewayError with valid errorCode', () => {
    const err = new ForgeGatewayError('PROVIDER_SERVER_ERROR', 'test error', { detail: 'x' });
    expect(err).toBeInstanceOf(ForgeGatewayError);
    expect(err).toBeInstanceOf(Error);
    const validCodes: FGE['errorCode'][] = [
      'DYNAMIC_IMPORT_FAILED',
      'PROVIDER_AUTHENTICATION_ERROR',
      'PROVIDER_RATE_LIMIT_EXCEEDED',
      'PROVIDER_QUOTA_EXHAUSTED',
      'CONTEXT_WINDOW_EXCEEDED',
      'PROVIDER_SERVER_ERROR',
      'SCHEMA_VALIDATION_FAILED',
      'OUTPUT_TRUNCATED_BY_LIMIT',
      'STATUTORY_RULE_VIOLATION',
      'CONFIGURATION_ERROR',
    ];
    expect(validCodes).toContain(err.errorCode);
  });

  // T10: Provider returns 429 twice then succeeds
  it('T10: retries on PROVIDER_RATE_LIMIT_EXCEEDED and succeeds on third attempt', async () => {
    const rateLimitErr = Object.assign(new Error('rate limited'), { status: 429 });
    mockGenerateText
      .mockRejectedValueOnce(rateLimitErr)
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValueOnce(makeTextResult('success after retries'));
    const delays: number[] = [];
    const mockDelay = async (ms: number) => {
      delays.push(ms);
    };
    const gw = new LLMGateway(makeConfig(), mockDelay);
    const result = await gw.executeTextTask('rules', 'instructions', 'context');
    expect(result.data).toBe('success after retries');
    expect(delays).toHaveLength(2);
  });

  // T11: Provider returns 429 three times → PROVIDER_RATE_LIMIT_EXCEEDED
  it('T11: exhausted retries on 429 throws PROVIDER_RATE_LIMIT_EXCEEDED', async () => {
    const rateLimitErr = Object.assign(new Error('rate limited'), { status: 429 });
    mockGenerateText
      .mockRejectedValueOnce(rateLimitErr)
      .mockRejectedValueOnce(rateLimitErr)
      .mockRejectedValueOnce(rateLimitErr);
    const mockDelay = async (_ms: number) => {};
    const gw = new LLMGateway(makeConfig(), mockDelay);
    const err = await catchError(
      gw.executeTextTask('rules', 'instructions', 'context'),
    );
    assertGatewayError(err, 'PROVIDER_RATE_LIMIT_EXCEEDED');
  });

  // T12: Jitter bounds — Math.random mocked to 0 → 2000ms; mocked to 1 → 3000ms
  it('T12: jitter bounded correctly — Math.random=0 gives 2000ms, Math.random=1 gives 3000ms', async () => {
    const rateLimitErr = Object.assign(new Error('rate limited'), { status: 429 });

    // First: Math.random = 0
    const delays: number[] = [];
    const mockDelay = async (ms: number) => {
      delays.push(ms);
    };
    mockGenerateText
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValueOnce(makeTextResult('ok'));
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    const gw1 = new LLMGateway(makeConfig(), mockDelay);
    await gw1.executeTextTask('rules', 'instructions', 'context');
    randomSpy.mockRestore();
    expect(delays[0]).toBe(2000);

    // Second: Math.random = 1
    const delays2: number[] = [];
    const mockDelay2 = async (ms: number) => {
      delays2.push(ms);
    };
    mockGenerateText
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValueOnce(makeTextResult('ok'));
    const randomSpy2 = jest.spyOn(Math, 'random').mockReturnValue(1);
    const gw2 = new LLMGateway(makeConfig(), mockDelay2);
    await gw2.executeTextTask('rules', 'instructions', 'context');
    randomSpy2.mockRestore();
    expect(delays2[0]).toBe(3000);
  });

  // T14: Concurrent calls on one instance initialize the provider exactly once
  it('T14: concurrent calls on one instance initialize the provider exactly once', async () => {
    mockGenerateText
      .mockResolvedValueOnce(makeTextResult('first'))
      .mockResolvedValueOnce(makeTextResult('second'));
    const gw = new LLMGateway(makeConfig());
    const [r1, r2] = await Promise.all([
      gw.executeTextTask('rules', 'instructions', 'context'),
      gw.executeTextTask('rules', 'instructions', 'context'),
    ]);
    expect(mockProviderFactory).toHaveBeenCalledTimes(1);
    expect(r1.data).toBe('first');
    expect(r2.data).toBe('second');
  });

  // T13: Two concurrent instances share no state
  it('T13: two concurrent LLMGateway instances are isolated — no shared state', async () => {
    const openaiModel: Record<string, unknown> = { _tag: 'OpenAIModel' };
    mockOpenAIFactory.mockReturnValue(openaiModel);

    mockGenerateText.mockImplementation((...args: unknown[]) => {
      const opts = args[0] as { model: { _tag: string } };
      if (opts.model._tag === 'MockModel') {
        return Promise.resolve(makeTextResult('anthropic response', 100, 50));
      }
      return Promise.resolve(makeTextResult('openai response', 200, 80));
    });

    const gwA = new LLMGateway(makeConfig('@ai-sdk/anthropic', 'anthropic'));
    const gwB = new LLMGateway({
      phase_id: 'phase-b',
      runtime_execution: {
        provider_package: '@ai-sdk/openai',
        provider_factory_method: 'openai',
        model_identifier: 'gpt-4o',
        settings: {},
      },
    });

    const [resultA, resultB] = await Promise.all([
      gwA.executeTextTask('rules-a', 'instructions', 'context'),
      gwB.executeTextTask('rules-b', 'instructions', 'context'),
    ]);

    expect(resultA.telemetry.tokensConsumedInput).toBe(100);
    expect(resultB.telemetry.tokensConsumedInput).toBe(200);
    expect(resultA.data).toBe('anthropic response');
    expect(resultB.data).toBe('openai response');
  });
});
