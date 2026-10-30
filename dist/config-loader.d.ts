import { ConfiguredLLMGateway } from './configured-gateway.js';
import type { GatewayConfig } from './types.js';
export declare class GatewayConfigLoader {
    private readonly config;
    constructor(config: GatewayConfig);
    static fromObject(config: GatewayConfig): GatewayConfigLoader;
    static fromFile(path: string): Promise<GatewayConfigLoader>;
    static fromEnv(varName?: string): GatewayConfigLoader;
    get(agentName: string): ConfiguredLLMGateway;
    agents(): string[];
}
//# sourceMappingURL=config-loader.d.ts.map