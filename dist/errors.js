export class ForgeGatewayError extends Error {
    errorCode;
    /**
     * Internal debugging data only. Never forward to end-user responses or
     * external log sinks — may contain provider error details, request IDs,
     * or partial credential hints from upstream API error payloads.
     */
    diagnostics;
    constructor(errorCode, message, diagnostics) {
        super(message);
        this.name = 'ForgeGatewayError';
        this.errorCode = errorCode;
        this.diagnostics = diagnostics;
        // Correct instanceof for compiled JS
        Object.setPrototypeOf(this, ForgeGatewayError.prototype);
    }
}
//# sourceMappingURL=errors.js.map