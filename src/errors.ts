import type { GatewayErrorCode } from './types.js';

export class ForgeGatewayError extends Error {
  readonly errorCode: GatewayErrorCode;
  /**
   * Internal debugging data only. Never forward to end-user responses or
   * external log sinks — may contain provider error details, request IDs,
   * or partial credential hints from upstream API error payloads.
   */
  readonly diagnostics?: object;

  constructor(errorCode: GatewayErrorCode, message: string, diagnostics?: object) {
    super(message);
    this.name = 'ForgeGatewayError';
    this.errorCode = errorCode;
    this.diagnostics = diagnostics;
    // Correct instanceof for compiled JS
    Object.setPrototypeOf(this, ForgeGatewayError.prototype);
  }
}
