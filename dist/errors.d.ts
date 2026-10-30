import type { GatewayErrorCode } from './types.js';
export declare class ForgeGatewayError extends Error {
    readonly errorCode: GatewayErrorCode;
    /**
     * Internal debugging data only. Never forward to end-user responses or
     * external log sinks — may contain provider error details, request IDs,
     * or partial credential hints from upstream API error payloads.
     */
    readonly diagnostics?: object;
    constructor(errorCode: GatewayErrorCode, message: string, diagnostics?: object);
}
//# sourceMappingURL=errors.d.ts.map