import { LLMGateway } from './llm-gateway.js';
import { ForgeGatewayError } from './errors.js';
export class ConfiguredLLMGateway {
    gateway;
    definition;
    compiledRules;
    constructor(definition, name = 'configured-agent', delayFn) {
        this.definition = definition;
        this.gateway = new LLMGateway({
            phase_id: name,
            runtime_execution: {
                provider_package: definition.provider_package,
                provider_factory_method: definition.provider_factory_method,
                model_identifier: definition.model_identifier,
                settings: definition.settings,
            },
        }, delayFn);
        this.compiledRules = (definition.compliance_rules ?? []).map((r) => {
            if (r.pattern.length > 500) {
                throw new ForgeGatewayError('CONFIGURATION_ERROR', `Compliance rule '${r.ruleId}' pattern exceeds maximum length of 500 characters`);
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
    async executeTextTask(instructionsOrVariables, contextPayload = '') {
        const instructions = this.resolveInstructions(instructionsOrVariables);
        return this.gateway.executeTextTask(this.definition.system_rules, instructions, contextPayload, this.compiledRules);
    }
    async executeStructuredTask(instructionsOrVariables, validationSchema, contextPayload = '') {
        const instructions = this.resolveInstructions(instructionsOrVariables);
        return this.gateway.executeStructuredTask(this.definition.system_rules, instructions, contextPayload, validationSchema);
    }
    resolveInstructions(instructionsOrVariables) {
        if (typeof instructionsOrVariables === 'string') {
            return instructionsOrVariables;
        }
        const template = this.definition.instruction_template;
        if (!template) {
            throw new ForgeGatewayError('CONFIGURATION_ERROR', 'instruction_template must be defined in the agent config when passing a variables map');
        }
        return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
            if (!Object.hasOwn(instructionsOrVariables, key)) {
                throw new ForgeGatewayError('CONFIGURATION_ERROR', `Template variable '{{${key}}}' was not provided`);
            }
            return instructionsOrVariables[key];
        });
    }
}
//# sourceMappingURL=configured-gateway.js.map