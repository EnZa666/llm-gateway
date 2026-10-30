import type { ZodSchema } from 'zod';
import { LLMGateway } from './llm-gateway.js';
import { ForgeGatewayError } from './errors.js';
import type {
  AgentDefinition,
  GatewayResponseEnvelope,
  TextComplianceRule,
} from './types.js';

export class ConfiguredLLMGateway {
  private readonly gateway: LLMGateway;
  private readonly definition: AgentDefinition;
  private readonly compiledRules: TextComplianceRule[];

  constructor(
    definition: AgentDefinition,
    name = 'configured-agent',
    delayFn?: (ms: number) => Promise<void>,
  ) {
    this.definition = definition;
    this.gateway = new LLMGateway(
      {
        phase_id: name,
        runtime_execution: {
          provider_package: definition.provider_package,
          provider_factory_method: definition.provider_factory_method,
          model_identifier: definition.model_identifier,
          settings: definition.settings,
        },
      },
      delayFn,
    );
    this.compiledRules = (definition.compliance_rules ?? []).map((r) => {
      if (r.pattern.length > 500) {
        throw new ForgeGatewayError(
          'CONFIGURATION_ERROR',
          `Compliance rule '${r.ruleId}' pattern exceeds maximum length of 500 characters`,
        );
      }
      return {
        ruleId: r.ruleId,
        type: r.type,
        pattern: new RegExp(r.pattern, r.flags),
        replacementValue: r.replacementValue,
        customErrorMessage: r.customErrorMessage,
      };
    });
  }

  async executeTextTask(
    instructionsOrVariables: string | Record<string, string>,
    contextPayload = '',
  ): Promise<GatewayResponseEnvelope<string>> {
    const instructions = this.resolveInstructions(instructionsOrVariables);
    return this.gateway.executeTextTask(
      this.definition.system_rules,
      instructions,
      contextPayload,
      this.compiledRules,
    );
  }

  async executeStructuredTask<T>(
    instructionsOrVariables: string | Record<string, string>,
    validationSchema: ZodSchema<T>,
    contextPayload = '',
  ): Promise<GatewayResponseEnvelope<T>> {
    const instructions = this.resolveInstructions(instructionsOrVariables);
    return this.gateway.executeStructuredTask(
      this.definition.system_rules,
      instructions,
      contextPayload,
      validationSchema,
    );
  }

  private resolveInstructions(instructionsOrVariables: string | Record<string, string>): string {
    if (typeof instructionsOrVariables === 'string') {
      return instructionsOrVariables;
    }
    const template = this.definition.instruction_template;
    if (!template) {
      throw new ForgeGatewayError(
        'CONFIGURATION_ERROR',
        'instruction_template must be defined in the agent config when passing a variables map',
      );
    }
    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      if (!Object.hasOwn(instructionsOrVariables, key)) {
        throw new ForgeGatewayError(
          'CONFIGURATION_ERROR',
          `Template variable '{{${key}}}' was not provided`,
        );
      }
      return instructionsOrVariables[key];
    });
  }
}
