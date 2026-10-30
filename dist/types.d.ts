export interface RuntimeExecutionConfig {
    provider_package: string;
    provider_factory_method: string;
    model_identifier: string;
    settings?: {
        temperature?: number;
        max_tokens?: number;
    };
}
export interface PhaseRuntimeConfig {
    phase_id: string;
    runtime_execution: RuntimeExecutionConfig;
}
export interface GatewayTelemetry {
    tokensConsumedInput: number;
    tokensConsumedOutput: number;
    executionDurationMs: number;
}
export interface GatewayResponseEnvelope<T> {
    data: T;
    telemetry: GatewayTelemetry;
}
export interface TextComplianceRule {
    ruleId: string;
    type: 'REPLACE' | 'REJECT';
    pattern: RegExp;
    replacementValue?: string;
    customErrorMessage?: string;
}
export interface SerializedComplianceRule {
    ruleId: string;
    type: 'REPLACE' | 'REJECT';
    pattern: string;
    flags?: string;
    replacementValue?: string;
    customErrorMessage?: string;
}
export interface AgentDefinition {
    provider_package: string;
    provider_factory_method: string;
    model_identifier: string;
    settings?: {
        temperature?: number;
        max_tokens?: number;
    };
    system_rules: string;
    compliance_rules?: SerializedComplianceRule[];
    instruction_template?: string;
}
export interface GatewayConfig {
    agents: Record<string, AgentDefinition>;
}
export type GatewayErrorCode = 'DYNAMIC_IMPORT_FAILED' | 'PROVIDER_AUTHENTICATION_ERROR' | 'PROVIDER_RATE_LIMIT_EXCEEDED' | 'PROVIDER_QUOTA_EXHAUSTED' | 'CONTEXT_WINDOW_EXCEEDED' | 'PROVIDER_SERVER_ERROR' | 'SCHEMA_VALIDATION_FAILED' | 'OUTPUT_TRUNCATED_BY_LIMIT' | 'STATUTORY_RULE_VIOLATION' | 'CONFIGURATION_ERROR';
//# sourceMappingURL=types.d.ts.map