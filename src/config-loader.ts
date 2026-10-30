import { readFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { z } from 'zod';
import { ConfiguredLLMGateway } from './configured-gateway.js';
import type { GatewayConfig } from './types.js';

const SerializedComplianceRuleSchema = z.object({
  ruleId: z.string(),
  type: z.enum(['REPLACE', 'REJECT']),
  // 500-char cap prevents catastrophic-backtracking (ReDoS) patterns
  pattern: z.string().max(500),
  flags: z.string().optional(),
  replacementValue: z.string().optional(),
  customErrorMessage: z.string().optional(),
});

const AgentDefinitionSchema = z.object({
  provider_package: z.string().refine(
    (v) => !isBuiltin(v) && /^(@[a-zA-Z0-9][a-zA-Z0-9-._]*\/)?[a-zA-Z0-9][a-zA-Z0-9-._]*$/.test(v),
    { message: 'Invalid npm package name' },
  ),
  provider_factory_method: z.string().refine(
    (v) => /^[a-zA-Z$][a-zA-Z0-9_$]*$/.test(v) && !v.startsWith('__') && v !== 'constructor',
    { message: 'Invalid factory method identifier' },
  ),
  model_identifier: z.string(),
  settings: z
    .object({
      temperature: z.number().optional(),
      max_tokens: z.number().optional(),
    })
    .optional(),
  system_rules: z.string(),
  compliance_rules: z.array(SerializedComplianceRuleSchema).optional(),
  instruction_template: z.string().optional(),
});

const GatewayConfigSchema = z.object({
  agents: z.record(AgentDefinitionSchema),
});

export class GatewayConfigLoader {
  private readonly config: GatewayConfig;

  constructor(config: GatewayConfig) {
    this.config = config;
  }

  static fromObject(config: GatewayConfig): GatewayConfigLoader {
    return new GatewayConfigLoader(GatewayConfigSchema.parse(config));
  }

  static async fromFile(path: string): Promise<GatewayConfigLoader> {
    const text = await readFile(path, 'utf-8');
    try {
      return new GatewayConfigLoader(GatewayConfigSchema.parse(JSON.parse(text)));
    } catch (err) {
      throw new Error(`Invalid config in '${path}': ${(err as Error).message}`);
    }
  }

  static fromEnv(varName = 'LLM_GATEWAY_CONFIG'): GatewayConfigLoader {
    const json = process.env[varName];
    if (!json) {
      throw new Error(`Environment variable '${varName}' is not set`);
    }
    try {
      return new GatewayConfigLoader(GatewayConfigSchema.parse(JSON.parse(json)));
    } catch (err) {
      throw new Error(
        `Invalid config in environment variable '${varName}': ${(err as Error).message}`,
      );
    }
  }

  get(agentName: string): ConfiguredLLMGateway {
    const definition = this.config.agents[agentName];
    if (!definition) {
      const available = Object.keys(this.config.agents).join(', ');
      throw new Error(
        `Agent '${agentName}' not found in config. Available agents: ${available}`,
      );
    }
    return new ConfiguredLLMGateway(definition, agentName);
  }

  agents(): string[] {
    return Object.keys(this.config.agents);
  }
}
