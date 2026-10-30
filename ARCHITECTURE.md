# Architecture

## Overview

`llm-gateway` is a thin, stateless execution layer that sits between application code and LLM provider SDKs. It handles the mechanical concerns — provider loading, retry, compliance, telemetry — so callers only deal with intent and result.

All provider choices, model identifiers, system prompts, and compliance rules are runtime data. No rebuild is required when switching providers or updating prompts.

```
agents.json / env var / plain object
  │
  └─► GatewayConfigLoader
            │
            └─ get('agent-name') → ConfiguredLLMGateway
                      │  (pre-binds: system_rules, compiledRules, LLMGateway)
                      │
                      ├─ executeTextTask(variables | string, contextPayload?)
                      │    ├─ resolveInstructions() — {{variable}} substitution
                      │    └─► LLMGateway.executeTextTask(systemRules, instructions, ...)
                      │
                      └─ executeStructuredTask(variables | string, schema, contextPayload?)
                           └─► LLMGateway.executeStructuredTask(...)

LLMGateway (also usable directly)
  │
  ├─ initialize() — dynamic import of provider package (once per instance)
  ├─ withRetry() — up to 3 attempts, exponential backoff + jitter
  ├─ generateText() / generateObject() — Vercel AI SDK
  ├─ filler-text strip (text tasks)
  └─ compliance rules (REPLACE → REJECT)
```

## Key design decisions

### Dynamic provider loading

The provider package (`@ai-sdk/anthropic`, `@ai-sdk/openai`, etc.) is loaded at runtime via `await import(provider_package)` rather than at bundle time. This keeps the module provider-agnostic and lets callers install only the provider they need.

The factory method name (`anthropic`, `openai`, …) is resolved from the loaded module, so adding a new provider requires zero changes to this library.

Both values are validated before the `import()` call fires:

- `isValidPackageName` rejects path-traversal strings (e.g. `../evil`) and Node.js built-in modules (e.g. `child_process`, `os`, `fs`) using `node:module`'s `isBuiltin()` check. Either of those in a config file would otherwise redirect `import()` to an OS-level execution path.
- `isValidFactoryMethod` accepts only safe JS identifiers and explicitly blocks `__`-prefixed names (`__proto__`, `__defineGetter__`) and `constructor` (present on all objects; calling it as a factory is a code-execution vector).

These guards fire at both config-load time (via Zod `.refine()` in `GatewayConfigSchema`) and inside `doInitialize()` as defence-in-depth for values that reach `LLMGateway` directly without going through `GatewayConfigLoader`.

### Promise-caching for concurrent init

`initialize()` stores the in-flight `Promise<void>` in `this.initPromise`. Concurrent callers all await the same promise, so the provider is instantiated exactly once per `LLMGateway` instance regardless of call concurrency.

```typescript
private initialize(): Promise<void> {
  if (this.initPromise === null) {
    this.initPromise = this.doInitialize();
  }
  return this.initPromise;
}
```

A new instance always gets a fresh provider; there is no module-level shared state.

### Typed error surface

Every failure is converted to a `ForgeGatewayError` with a `GatewayErrorCode` before it leaves the class. HTTP status codes are mapped deterministically; ambiguous cases (HTTP 400) fall back to message heuristics before defaulting to `PROVIDER_SERVER_ERROR`. This means callers can `switch` on `err.errorCode` without inspecting raw HTTP responses.

### Retry scope

Only `PROVIDER_RATE_LIMIT_EXCEEDED` and `PROVIDER_SERVER_ERROR` are retried — conditions that are transient by definition. Authentication errors, quota exhaustion, context-window violations, schema failures, and compliance violations are thrown immediately; retrying them would waste tokens and delay the error signal.

### Constructor-injected delay

The retry sleep function defaults to `setTimeout`-backed `Promise<void>` but is accepted as a constructor parameter. Tests pass a synchronous no-op (or a spy) to avoid real delays while still verifying that the correct delay values are computed.

### Compliance rule ordering

`REPLACE` rules run before `REJECT` rules. This allows a normalisation pass (e.g. `optimize → optimise`) before a content gate fires, avoiding false positives when the substitution itself would have satisfied the gate.

## Module structure

```
src/
  index.ts              — public re-exports
  llm-gateway.ts        — LLMGateway class (provider init, retry, compliance)
  configured-gateway.ts — ConfiguredLLMGateway (pre-bound system rules, template resolution)
  config-loader.ts      — GatewayConfigLoader (fromFile / fromEnv / fromObject)
  errors.ts             — ForgeGatewayError (extends Error, correct instanceof)
  types.ts              — all shared types including AgentDefinition, GatewayConfig,
                          SerializedComplianceRule, GatewayResponseEnvelope, GatewayErrorCode
  __tests__/
    llm-gateway.test.ts   — 14 unit tests for LLMGateway
    config-loader.test.ts — 13 unit tests for GatewayConfigLoader and ConfiguredLLMGateway
```

## Testing approach

Tests mock the Vercel AI SDK (`ai`) and provider packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`) at the module level using `jest.unstable_mockModule`. The `LLMGateway` class is then imported dynamically after mock registration, so all provider loading goes through the mock.

The test suite covers:
- Happy-path text and structured responses
- Compliance rule application (REPLACE, REJECT, ordering)
- Every error code path
- Retry mechanics (success on nth attempt, exhaustion)
- Jitter bounds
- Concurrent-call init idempotency (T14)
- Multi-instance isolation (T13)

## Config-file layer design decisions

### SerializedComplianceRule

`TextComplianceRule` uses live `RegExp` objects, which are not JSON-serialisable. `SerializedComplianceRule` stores `pattern` (RegExp source string) and `flags` (e.g. `"gi"`) separately. `ConfiguredLLMGateway` compiles them to `RegExp` once at construction time, not on each call.

### Template resolution

`{{variable}}` substitution uses a single `String.prototype.replace` with a named-capture regex. Variables that appear in the template but are absent from the supplied map throw immediately with the missing key named in the message — this surfaces misconfigured templates at call time rather than silently producing empty strings.

The presence check uses `Object.hasOwn` rather than the `in` operator. The `in` operator traverses the prototype chain, so a template variable named `toString` or `constructor` would silently resolve to the inherited function's string representation rather than throw; `Object.hasOwn` restricts the lookup to own properties only.

Passing a plain string bypasses the template entirely; this lets callers override a templated agent with a one-off instruction without touching the config.

### Config validation with Zod

All three entry points (`fromFile`, `fromEnv`, `fromObject`) run the config through `GatewayConfigSchema.parse()` before storing it. The schema enforces:

- `provider_package` must be a valid npm package name and not a Node.js built-in
- `provider_factory_method` must be a safe JS identifier (no `__` prefix, no `constructor`)
- `compliance_rules[].pattern` must be ≤ 500 characters (ReDoS prevention)
- All required fields must be present and correctly typed

Removing the `as GatewayConfig` cast after the Zod parse means TypeScript verifies structural compatibility between the schema's inferred type and `GatewayConfig` at compile time; future drift between the two will be a build error rather than a silent runtime mismatch.

### GatewayConfigLoader as a factory

The loader holds the parsed `GatewayConfig` and constructs a fresh `ConfiguredLLMGateway` on each `get()` call. Callers that want to reuse an instance cache it themselves; the library does not maintain a singleton registry.

## What this library does not do

- **Prompt templating** — callers own `systemRules`, `instructions`, and `contextPayload` as plain strings.
- **Conversation history** — stateless; each call is independent.
- **Streaming** — both methods return after the full response is available.
- **Distributed tracing** — telemetry is returned in the response envelope; span creation is the caller's responsibility.
- **Token budgeting** — `max_tokens` is a provider setting passed through `PhaseRuntimeConfig.runtime_execution.settings`.
