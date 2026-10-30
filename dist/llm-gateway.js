import { generateText, generateObject } from 'ai';
import { isBuiltin } from 'node:module';
import { ForgeGatewayError } from './errors.js';
function isValidPackageName(pkg) {
    // isBuiltin blocks child_process, os, fs, etc. — Node built-ins are not npm packages
    if (isBuiltin(pkg))
        return false;
    return /^(@[a-zA-Z0-9][a-zA-Z0-9-._]*\/)?[a-zA-Z0-9][a-zA-Z0-9-._]*$/.test(pkg);
}
function isValidFactoryMethod(name) {
    // 'constructor' is a property on all objects; calling it via factory is a code-execution vector
    return /^[a-zA-Z$][a-zA-Z0-9_$]*$/.test(name) && !name.startsWith('__') && name !== 'constructor';
}
const FILLER_LEADING = /^(?:(?:Sure|Certainly|Absolutely|Of course|Great)[,!]?\s+(?:here(?:'s| is)(?:\s+(?:your|the|a)\s+\w+)?)?[:\s]*|(?:I'(?:d|ll) be happy to (?:help|assist)[.!]\s*))+/i;
const FILLER_TRAILING = /(?:\s*(?:I hope this helps[.!]?|Let me know if you need anything else[.!]?|Feel free to ask[.!]?))+\s*$/i;
const RETRYABLE_CODES = new Set([
    'PROVIDER_RATE_LIMIT_EXCEEDED',
    'PROVIDER_SERVER_ERROR',
]);
const BASE_DELAYS_MS = [2000, 4000, 8000];
const DEFAULT_DELAY_FN = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class LLMGateway {
    config;
    delayFn;
    model = null;
    initPromise = null;
    constructor(config, delayFn = DEFAULT_DELAY_FN) {
        this.config = config;
        this.delayFn = delayFn;
    }
    initialize() {
        if (this.initPromise === null) {
            this.initPromise = this.doInitialize();
        }
        return this.initPromise;
    }
    async doInitialize() {
        const { provider_package, provider_factory_method, model_identifier, settings } = this.config.runtime_execution;
        if (!isValidPackageName(provider_package)) {
            throw new ForgeGatewayError('CONFIGURATION_ERROR', `provider_package '${provider_package}' is not a valid npm package name`);
        }
        if (!isValidFactoryMethod(provider_factory_method)) {
            throw new ForgeGatewayError('CONFIGURATION_ERROR', `provider_factory_method '${provider_factory_method}' is not a valid identifier`);
        }
        try {
            // Dynamic import — variable expression, never a string literal
            const resolvedModule = await import(/* @vite-ignore */ provider_package);
            const factory = resolvedModule[provider_factory_method];
            if (typeof factory !== 'function') {
                throw new Error(`Factory method '${provider_factory_method}' not found in '${provider_package}'`);
            }
            // Handle explicit constructor factories (e.g. createOpenAI) versus shortcut functions (e.g. openai)
            if (provider_factory_method === 'createOpenAI') {
                const providerInstance = factory({
                    baseURL: process.env.BASE_URL,
                    apiKey: process.env.API_KEY,
                });
                this.model = providerInstance(model_identifier, settings ?? {});
            }
            else {
                this.model = factory(model_identifier, settings ?? {});
            }
        }
        catch (err) {
            if (err instanceof ForgeGatewayError)
                throw err;
            throw new ForgeGatewayError('DYNAMIC_IMPORT_FAILED', `Failed to initialize provider '${provider_package}': ${err.message}`, { originalError: String(err) });
        }
    }
    mapProviderError(err) {
        if (err instanceof ForgeGatewayError)
            return err;
        const message = err instanceof Error ? err.message : String(err);
        const anyErr = err;
        const status = anyErr.status ?? anyErr.statusCode;
        let code = 'PROVIDER_SERVER_ERROR';
        if (status === 401 || status === 403) {
            code = 'PROVIDER_AUTHENTICATION_ERROR';
        }
        else if (status === 402) {
            code = 'PROVIDER_QUOTA_EXHAUSTED';
        }
        else if (status === 429) {
            code = /quota|credit|billing/i.test(message)
                ? 'PROVIDER_QUOTA_EXHAUSTED'
                : 'PROVIDER_RATE_LIMIT_EXCEEDED';
        }
        else if (status === 400) {
            code = /context|token|length|too.?long/i.test(message)
                ? 'CONTEXT_WINDOW_EXCEEDED'
                : 'PROVIDER_SERVER_ERROR';
        }
        else if (typeof status === 'number' && status >= 500) {
            code = 'PROVIDER_SERVER_ERROR';
        }
        return new ForgeGatewayError(code, message, { status, originalError: String(err) });
    }
    async withRetry(fn) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await fn();
            }
            catch (err) {
                const mapped = this.mapProviderError(err);
                if (!RETRYABLE_CODES.has(mapped.errorCode) || attempt === 2) {
                    throw mapped;
                }
                const base = BASE_DELAYS_MS[attempt] ?? 8000;
                await this.delayFn(base + Math.random() * 1000);
            }
        }
        // TypeScript cannot infer that attempt===2 always throws above
        throw new Error('unreachable');
    }
    async executeTextTask(systemRules, instructions, contextPayload, complianceRules) {
        await this.initialize();
        const start = Date.now();
        const result = await this.withRetry(() => generateText({
            model: this.model,
            system: systemRules,
            messages: [{ role: 'user', content: `${instructions}\n\n${contextPayload}` }],
        }));
        const executionDurationMs = Date.now() - start;
        let text = result.text
            .replace(FILLER_LEADING, '')
            .replace(FILLER_TRAILING, '')
            .trim();
        for (const rule of complianceRules ?? []) {
            if (rule.type === 'REPLACE') {
                text = text.replace(rule.pattern, rule.replacementValue ?? '');
            }
            else {
                // Reset lastIndex for global RegExp before testing
                rule.pattern.lastIndex = 0;
                if (rule.pattern.test(text)) {
                    throw new ForgeGatewayError('STATUTORY_RULE_VIOLATION', rule.customErrorMessage ?? `Compliance rule '${rule.ruleId}' violated`);
                }
            }
        }
        return {
            data: text,
            telemetry: {
                tokensConsumedInput: result.usage.promptTokens,
                tokensConsumedOutput: result.usage.completionTokens,
                executionDurationMs,
            },
        };
    }
    async executeStructuredTask(systemRules, instructions, contextPayload, validationSchema) {
        await this.initialize();
        const start = Date.now();
        let sdkResult;
        try {
            const raw = await this.withRetry(async () => {
                try {
                    return await generateObject({
                        model: this.model,
                        system: systemRules,
                        messages: [{ role: 'user', content: `${instructions}\n\n${contextPayload}` }],
                        schema: validationSchema,
                    });
                }
                catch (innerErr) {
                    // Wrap Zod/schema errors before withRetry classifies them as PROVIDER_SERVER_ERROR
                    if (!(innerErr instanceof ForgeGatewayError)) {
                        const msg = innerErr instanceof Error ? innerErr.message : String(innerErr);
                        if (/validation|parse|zod/i.test(msg)) {
                            throw new ForgeGatewayError('SCHEMA_VALIDATION_FAILED', msg, { zodError: innerErr });
                        }
                    }
                    throw innerErr;
                }
            });
            sdkResult = raw;
        }
        catch (err) {
            if (err instanceof ForgeGatewayError)
                throw err;
            throw this.mapProviderError(err);
        }
        const executionDurationMs = Date.now() - start;
        if (sdkResult.finishReason === 'length') {
            throw new ForgeGatewayError('OUTPUT_TRUNCATED_BY_LIMIT', 'Generation stopped at token limit before output was complete');
        }
        return {
            data: sdkResult.object,
            telemetry: {
                tokensConsumedInput: sdkResult.usage.promptTokens,
                tokensConsumedOutput: sdkResult.usage.completionTokens,
                executionDurationMs,
            },
        };
    }
}
//# sourceMappingURL=llm-gateway.js.map