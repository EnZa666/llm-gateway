import { jest, describe, it, expect, beforeEach } from '@jest/globals';

jest.unstable_mockModule('ai', () => ({
  generateText: jest.fn(),
  generateObject: jest.fn(),
}));

const mockProviderFactory = jest.fn();
mockProviderFactory.mockReturnValue({ _tag: 'MockModel' });

jest.unstable_mockModule('@ai-sdk/anthropic', () => ({
  anthropic: mockProviderFactory,
}));

jest.unstable_mockModule('node:fs/promises', () => ({
  readFile: jest.fn(),
}));

const aiModule = await import('ai');
type AnyMock = jest.Mock;
const mockGenerateText = aiModule.generateText as unknown as AnyMock;

const fsModule = await import('node:fs/promises');
const mockReadFile = fsModule.readFile as unknown as AnyMock;

const { GatewayConfigLoader } = await import('../config-loader.js');
const { ConfiguredLLMGateway } = await import('../configured-gateway.js');
const { ForgeGatewayError } = await import('../errors.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTextResult = (text: string) => ({
  text,
  usage: { promptTokens: 100, completionTokens: 50 },
  finishReason: 'stop',
  experimental_providerMetadata: {},
  response: {},
  warnings: [],
  rawCall: {},
});

const baseConfig = () => ({
  agents: {
    'resume-scorer': {
      provider_package: '@ai-sdk/anthropic',
      provider_factory_method: 'anthropic',
      model_identifier: 'claude-sonnet-4-5',
      settings: { temperature: 0.3, max_tokens: 1024 },
      system_rules: 'You are a professional resume evaluator.',
      instruction_template: 'Score this resume.\n\nResume:\n{{resume}}\n\nJD:\n{{jd}}',
      compliance_rules: [
        { ruleId: 'no-delve', type: 'REJECT' as const, pattern: '\\bdelve\\b', flags: 'gi' },
        { ruleId: 'spell-optimise', type: 'REPLACE' as const, pattern: 'optimize', flags: 'gi', replacementValue: 'optimise' },
      ],
    },
    'cover-letter-writer': {
      provider_package: '@ai-sdk/anthropic',
      provider_factory_method: 'anthropic',
      model_identifier: 'claude-haiku-4-5',
      system_rules: 'You are a cover letter writer.',
    },
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockProviderFactory.mockReturnValue({ _tag: 'MockModel' });
});

// ---------------------------------------------------------------------------
// GatewayConfigLoader
// ---------------------------------------------------------------------------

describe('GatewayConfigLoader', () => {
  it('CL1: fromObject returns a loader with the configured agents', () => {
    const loader = GatewayConfigLoader.fromObject(baseConfig());
    expect(loader.agents()).toEqual(['resume-scorer', 'cover-letter-writer']);
  });

  it('CL2: get returns a ConfiguredLLMGateway for a known agent', () => {
    const loader = GatewayConfigLoader.fromObject(baseConfig());
    const gw = loader.get('resume-scorer');
    expect(gw).toBeInstanceOf(ConfiguredLLMGateway);
  });

  it('CL3: get throws with a helpful message for an unknown agent', () => {
    const loader = GatewayConfigLoader.fromObject(baseConfig());
    expect(() => loader.get('nonexistent')).toThrow(/nonexistent/);
    expect(() => loader.get('nonexistent')).toThrow(/resume-scorer/);
  });

  it('CL4: fromFile reads and parses JSON from disk', async () => {
    const config = baseConfig();
    mockReadFile.mockResolvedValueOnce(JSON.stringify(config));
    const loader = await GatewayConfigLoader.fromFile('./agents.json');
    expect(mockReadFile).toHaveBeenCalledWith('./agents.json', 'utf-8');
    expect(loader.agents()).toEqual(['resume-scorer', 'cover-letter-writer']);
  });

  it('CL5: fromEnv reads and parses config from an environment variable', () => {
    const config = baseConfig();
    const original = process.env['LLM_GATEWAY_CONFIG'];
    process.env['LLM_GATEWAY_CONFIG'] = JSON.stringify(config);
    try {
      const loader = GatewayConfigLoader.fromEnv();
      expect(loader.agents()).toEqual(['resume-scorer', 'cover-letter-writer']);
    } finally {
      if (original === undefined) {
        delete process.env['LLM_GATEWAY_CONFIG'];
      } else {
        process.env['LLM_GATEWAY_CONFIG'] = original;
      }
    }
  });

  it('CL6: fromEnv throws when the environment variable is not set', () => {
    const original = process.env['LLM_GATEWAY_CONFIG_MISSING'];
    delete process.env['LLM_GATEWAY_CONFIG_MISSING'];
    try {
      expect(() => GatewayConfigLoader.fromEnv('LLM_GATEWAY_CONFIG_MISSING')).toThrow(
        /LLM_GATEWAY_CONFIG_MISSING/,
      );
    } finally {
      if (original !== undefined) process.env['LLM_GATEWAY_CONFIG_MISSING'] = original;
    }
  });
});

// ---------------------------------------------------------------------------
// ConfiguredLLMGateway
// ---------------------------------------------------------------------------

describe('ConfiguredLLMGateway', () => {
  it('CG1: pre-binds system_rules — gateway is called with the agent system prompt', async () => {
    mockGenerateText.mockResolvedValueOnce(makeTextResult('great candidate'));
    const loader = GatewayConfigLoader.fromObject(baseConfig());
    const gw = loader.get('resume-scorer');
    await gw.executeTextTask('score this resume', 'context');
    const call = mockGenerateText.mock.calls[0] as [{ system: string }];
    expect(call[0].system).toBe('You are a professional resume evaluator.');
  });

  it('CG2: template variables are interpolated into instructions', async () => {
    mockGenerateText.mockResolvedValueOnce(makeTextResult('score: 8'));
    const loader = GatewayConfigLoader.fromObject(baseConfig());
    const gw = loader.get('resume-scorer');
    await gw.executeTextTask({ resume: 'my resume', jd: 'my job description' });
    const call = mockGenerateText.mock.calls[0] as [{ messages: [{ content: string }] }];
    const content = call[0].messages[0].content;
    expect(content).toContain('my resume');
    expect(content).toContain('my job description');
  });

  it('CG3: missing template variable throws ForgeGatewayError', async () => {
    const loader = GatewayConfigLoader.fromObject(baseConfig());
    const gw = loader.get('resume-scorer');
    await expect(gw.executeTextTask({ resume: 'only resume, no jd' })).rejects.toThrow(
      ForgeGatewayError,
    );
    await expect(gw.executeTextTask({ resume: 'only resume, no jd' })).rejects.toThrow(
      /\{\{jd\}\}/,
    );
  });

  it('CG4: variables map without instruction_template throws ForgeGatewayError', async () => {
    const loader = GatewayConfigLoader.fromObject(baseConfig());
    const gw = loader.get('cover-letter-writer'); // no instruction_template
    await expect(gw.executeTextTask({ someVar: 'value' })).rejects.toThrow(ForgeGatewayError);
    await expect(gw.executeTextTask({ someVar: 'value' })).rejects.toThrow(
      /instruction_template/,
    );
  });

  it('CG5: serialized compliance rules are compiled and applied', async () => {
    mockGenerateText.mockResolvedValueOnce(makeTextResult('this will optimize the score'));
    const loader = GatewayConfigLoader.fromObject(baseConfig());
    const gw = loader.get('resume-scorer');
    const result = await gw.executeTextTask('instructions', 'context');
    expect(result.data).toContain('optimise');
    expect(result.data).not.toContain('optimize');
  });

  it('CG6: REJECT compliance rule compiled from serialized form fires correctly', async () => {
    mockGenerateText.mockResolvedValueOnce(makeTextResult('we should delve into this'));
    const loader = GatewayConfigLoader.fromObject(baseConfig());
    const gw = loader.get('resume-scorer');
    await expect(gw.executeTextTask('instructions', 'context')).rejects.toThrow(ForgeGatewayError);
  });

  it('CG7: raw string instructions bypass template and pass through directly', async () => {
    mockGenerateText.mockResolvedValueOnce(makeTextResult('result'));
    const loader = GatewayConfigLoader.fromObject(baseConfig());
    const gw = loader.get('resume-scorer');
    await gw.executeTextTask('raw instructions string', 'ctx');
    const call = mockGenerateText.mock.calls[0] as [{ messages: [{ content: string }] }];
    expect(call[0].messages[0].content).toContain('raw instructions string');
  });
});
