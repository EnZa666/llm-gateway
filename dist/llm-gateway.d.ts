import type { ZodSchema } from 'zod';
import type { PhaseRuntimeConfig, GatewayResponseEnvelope, TextComplianceRule } from './types.js';
export declare class LLMGateway {
    private readonly config;
    private readonly delayFn;
    private model;
    private initPromise;
    constructor(config: PhaseRuntimeConfig, delayFn?: (ms: number) => Promise<void>);
    private initialize;
    private doInitialize;
    private mapProviderError;
    private withRetry;
    executeTextTask(systemRules: string, instructions: string, contextPayload: string, complianceRules?: TextComplianceRule[]): Promise<GatewayResponseEnvelope<string>>;
    executeStructuredTask<T>(systemRules: string, instructions: string, contextPayload: string, validationSchema: ZodSchema<T>): Promise<GatewayResponseEnvelope<T>>;
}
//# sourceMappingURL=llm-gateway.d.ts.map