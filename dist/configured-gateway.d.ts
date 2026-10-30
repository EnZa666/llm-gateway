import type { ZodSchema } from 'zod';
import type { AgentDefinition, GatewayResponseEnvelope } from './types.js';
export declare class ConfiguredLLMGateway {
    private readonly gateway;
    private readonly definition;
    private readonly compiledRules;
    constructor(definition: AgentDefinition, name?: string, delayFn?: (ms: number) => Promise<void>);
    executeTextTask(instructionsOrVariables: string | Record<string, string>, contextPayload?: string): Promise<GatewayResponseEnvelope<string>>;
    executeStructuredTask<T>(instructionsOrVariables: string | Record<string, string>, validationSchema: ZodSchema<T>, contextPayload?: string): Promise<GatewayResponseEnvelope<T>>;
    private resolveInstructions;
}
//# sourceMappingURL=configured-gateway.d.ts.map