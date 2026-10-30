# llm-gateway

A TypeScript library built on the [Vercel AI SDK](https://sdk.vercel.ai/) that adds retry handling, response telemetry, filler-text removal, and output compliance rules.

Agent configuration is stored in a JSON file, including the provider, model, system prompt, and compliance rules. You can change providers or update prompts without changing application code.

## Install

```bash
npm install llm-gateway ai zod @ai-sdk/anthropic
```

**Peer dependencies:** `ai >= 4.0.0`, `zod >= 3.0.0`

Install at least one provider: `@ai-sdk/anthropic >= 1.0.0` or `@ai-sdk/openai >= 1.0.0`

**Requires:** Node.js ≥ 18 (ESM), TypeScript ≥ 5.3

---

## Quick start — config file

Define agents in a JSON file. You can add agents, change providers, and update prompts without modifying your application code.

**`agents.json`**

```json
{
  "agents": {
    "resume-scorer": {
      "provider_package": "@ai-sdk/anthropic",
      "provider_factory_method": "anthropic",
      "model_identifier": "claude-sonnet-4-5",
      "settings": { "temperature": 0.3, "max_tokens": 1024 },
      "system_rules": "You are a professional resume evaluator. Be concise and specific.",
      "instruction_template": "Score this resume against the job description.\n\nResume:\n{{resume}}\n\nJob Description:\n{{jd}}",
      "compliance_rules": [
        { "ruleId": "no-delve", "type": "REJECT", "pattern": "\\bdelve\\b", "flags": "gi" }
      ]
    },
    "cover-letter-writer": {
      "provider_package": "@ai-sdk/openai",
      "provider_factory_method": "openai",
      "model_identifier": "gpt-4o",
      "settings": { "temperature": 0.7, "max_tokens": 800 },
      "system_rules": "You are a professional cover letter writer."
    }
  }
}
```

**`app.ts`**

```typescript
import { GatewayConfigLoader } from 'llm-gateway';

const loader = await GatewayConfigLoader.fromFile('./agents.json');

const scorer = loader.get('resume-scorer');
const result = await scorer.executeTextTask({
  resume: resumeText,
  jd: jobDescriptionText,
});

console.log(result.data);
// → scored feedback, filler stripped, compliance rules applied

console.log(result.telemetry);
// → { tokensConsumedInput: 312, tokensConsumedOutput: 498, executionDurationMs: 2041 }
```

### Load configuration from an environment variable

This is useful in containerised deployments where you don't want to keep a config file on disk:

```bash
export LLM_GATEWAY_CONFIG='{"agents": {"my-agent": { ... }}}'
```

```typescript
const loader = GatewayConfigLoader.fromEnv(); // reads LLM_GATEWAY_CONFIG
```

### Use a different environment variable

```typescript
const loader = GatewayConfigLoader.fromEnv('MY_AGENTS_CONFIG');
```

---

## Quick start — direct API

You can also create a gateway in code, without using a config file:

```typescript
import { LLMGateway } from 'llm-gateway';

const gateway = new LLMGateway({
  phase_id: 'cover-letter',
  runtime_execution: {
    provider_package: '@ai-sdk/anthropic',
    provider_factory_method: 'anthropic',
    model_identifier: 'claude-sonnet-4-5',
    settings: { temperature: 0.7, max_tokens: 1024 },
  },
});

const result = await gateway.executeTextTask(
  'You are a professional writing assistant.',
  'Write a cover letter for a senior engineer role.',
  JSON.stringify({ company: 'Acme', role: 'Senior Engineer' }),
);
```

---

## Why this exists

LangChain and CrewAI are designed for orchestration: multi-step pipelines, memory, and tool chaining. If your application makes a single agent call for each user action, that level of orchestration may be unnecessary. Using a provider SDK directly also means handling retries, token usage, and output filtering at each call site.

`llm-gateway` provides a shared layer for those tasks.

Agent configuration—including the provider, model, instructions, and rules—is loaded from a JSON file at runtime. To change a system prompt, switch from Claude to GPT, or adjust the temperature, edit the configuration rather than the application code.

The gateway has a narrow responsibility: it accepts instructions and returns text or a structured object. It does not access the file system or know which part of your application called it. Your application remains responsible for fetching data, assembling context, and handling the response.

Retry handling, compliance rules, filler-text removal, and token telemetry work the same way for every agent call. Keeping these features in one place avoids duplicating logic across the application.

---

## What it covers

- **Provider switching** — change `provider_package` and `provider_factory_method` in the config; no application code changes are needed.
- **JSON configuration** — load agent settings from a file, an environment variable, or a plain object.
- **Instruction templates** — define `{{variable}}` placeholders in the config and provide their values at call time.
- **Typed errors** — failures are mapped to a `GatewayErrorCode`, so you can handle them with a `switch` statement instead of inspecting raw HTTP responses.
- **Automatic retry** — exponential backoff with jitter for rate limits and server errors (3 attempts; 2 s, 4 s, and 8 s).
- **Response telemetry** — each call returns `tokensConsumedInput`, `tokensConsumedOutput`, and `executionDurationMs`.
- **Output compliance** — define `REPLACE` or `REJECT` rules for each agent in the config. `REPLACE` rules run before `REJECT` rules.
- **Filler-text removal** — removes leading and trailing AI filler phrases from text responses.

---

## API

### `GatewayConfigLoader`

| Method | Returns | Description |
|---|---|---|
| `fromObject(config)` | `GatewayConfigLoader` | Loads and validates configuration from a plain object. |
| `fromFile(path)` | `Promise<GatewayConfigLoader>` | Loads and validates configuration from a JSON file. |
| `fromEnv(varName?)` | `GatewayConfigLoader` | Loads and validates configuration from an environment variable. Defaults to `LLM_GATEWAY_CONFIG`. |
| `get(agentName)` | `ConfiguredLLMGateway` | Returns the named agent. Throws an error if the agent is not found. |
| `agents()` | `string[]` | Returns the names of all configured agents. |

All three factory methods use the same Zod schema for validation. The loader rejects invalid `provider_package` values (including path traversal and Node.js built-in modules), invalid `provider_factory_method` identifiers, and `pattern` strings longer than 500 characters. It reports these errors when the configuration is loaded.

---

### `ConfiguredLLMGateway`

Returned by `loader.get(name)`. The agent's system rules and compliance rules are bound when the instance is created.

#### `executeTextTask(instructionsOrVariables, contextPayload?)`

- Pass a `string` to provide instructions directly.
- Pass a `Record<string, string>` to populate the agent's `instruction_template`. The method throws if a required variable is missing or if no template is defined.
- `contextPayload` is optional and is appended to the user message. It defaults to `''`.
- Returns `GatewayResponseEnvelope<string>`.

#### `executeStructuredTask<T>(instructionsOrVariables, validationSchema, contextPayload?)`

Uses the same instruction resolution as `executeTextTask`. Returns `GatewayResponseEnvelope<T>`.

---

### `new LLMGateway(config, delayFn?)`

| Param | Type | Description |
|---|---|---|
| `config` | `PhaseRuntimeConfig` | Provider and model configuration. |
| `delayFn` | `(ms: number) => Promise<void>` | Overrides the retry delay. Useful in tests. |

#### `executeTextTask(systemRules, instructions, contextPayload, complianceRules?)`

Calls the provider and returns `GatewayResponseEnvelope<string>`. It removes filler text and applies compliance rules in order.

#### `executeStructuredTask<T>(systemRules, instructions, contextPayload, validationSchema)`

Calls the provider with a Zod schema and returns `GatewayResponseEnvelope<T>`. It throws `SCHEMA_VALIDATION_FAILED` if the model output does not match the schema, or `OUTPUT_TRUNCATED_BY_LIMIT` if generation stops because it reaches the token limit.

---

### Config types

#### `GatewayConfig`

```typescript
interface GatewayConfig {
  agents: Record<string, AgentDefinition>;
}
```

#### `AgentDefinition`

```typescript
interface AgentDefinition {
  provider_package: string;         // e.g. '@ai-sdk/anthropic'
  provider_factory_method: string;  // e.g. 'anthropic'
  model_identifier: string;        // e.g. 'claude-sonnet-4-5'
  settings?: {
    temperature?: number;
    max_tokens?: number;
  };
  system_rules: string;
  compliance_rules?: SerializedComplianceRule[];
  instruction_template?: string;   // Uses {{variable}} placeholders
}
```

#### `SerializedComplianceRule`

A JSON-safe compliance rule. The regular expression is provided as a string:

```typescript
interface SerializedComplianceRule {
  ruleId: string;
  type: 'REPLACE' | 'REJECT';
  pattern: string;            // RegExp source, e.g. "\\bdelve\\b" — max 500 chars
  flags?: string;             // RegExp flags, e.g. "gi"
  replacementValue?: string;  // required when type === 'REPLACE'
  customErrorMessage?: string;
}
```

> **Note:** `pattern` is limited to 500 characters. Longer patterns are rejected when the configuration is loaded to reduce the risk of catastrophic backtracking (ReDoS).

#### `PhaseRuntimeConfig` (direct API)

```typescript
interface PhaseRuntimeConfig {
  phase_id: string;
  runtime_execution: {
    provider_package: string;
    provider_factory_method: string;
    model_identifier: string;
    settings?: {
      temperature?: number;
      max_tokens?: number;
    };
  };
}
```

---

### `TextComplianceRule` (direct API)

```typescript
interface TextComplianceRule {
  ruleId: string;
  type: 'REPLACE' | 'REJECT';
  pattern: RegExp;
  replacementValue?: string;
  customErrorMessage?: string;
}
```

`REPLACE` rules run before `REJECT` rules. In `AgentDefinition`, use `SerializedComplianceRule` with the pattern stored as a string. `ConfiguredLLMGateway` compiles these patterns to `RegExp` when it is constructed.

---

### `GatewayResponseEnvelope<T>`

```typescript
interface GatewayResponseEnvelope<T> {
  data: T;
  telemetry: {
    tokensConsumedInput: number;
    tokensConsumedOutput: number;
    executionDurationMs: number;
  };
}
```

---

### `GatewayErrorCode`

| Code | Trigger |
|---|---|
| `DYNAMIC_IMPORT_FAILED` | The provider package could not be loaded. |
| `PROVIDER_AUTHENTICATION_ERROR` | HTTP 401 / 403. |
| `PROVIDER_RATE_LIMIT_EXCEEDED` | HTTP 429 (rate limit; retried). |
| `PROVIDER_QUOTA_EXHAUSTED` | HTTP 402 or quota/billing 429. |
| `CONTEXT_WINDOW_EXCEEDED` | HTTP 400 with a context or length error. |
| `PROVIDER_SERVER_ERROR` | HTTP 5xx or an unclassified 400 (retried). |
| `SCHEMA_VALIDATION_FAILED` | Zod parse error on structured output. |
| `OUTPUT_TRUNCATED_BY_LIMIT` | `finishReason === 'length'`. |
| `STATUTORY_RULE_VIOLATION` | A `REJECT` compliance rule matched. |
| `CONFIGURATION_ERROR` | Invalid `provider_package` or `provider_factory_method`, missing `instruction_template`, or an unresolved template variable. |

All errors are instances of `ForgeGatewayError`, which extends `Error` and includes an `errorCode: GatewayErrorCode` property.

---

## Retry behaviour

Retries are triggered only by `PROVIDER_RATE_LIMIT_EXCEEDED` and `PROVIDER_SERVER_ERROR`. The gateway makes up to 3 attempts, with delays of 2 s, 4 s, and 8 s, plus up to 1 s of random jitter. All other error codes are thrown immediately.

## Structured output example

```typescript
import { z } from 'zod';
import { GatewayConfigLoader } from 'llm-gateway';

const ScoreSchema = z.object({
  score: z.number().min(0).max(10),
  rationale: z.string(),
});

const loader = await GatewayConfigLoader.fromFile('./agents.json');
const scorer = loader.get('resume-scorer');

const result = await scorer.executeStructuredTask(
  { resume: resumeText, jd: jobDescriptionText },
  ScoreSchema,
);

console.log(result.data.score);     // → 8
console.log(result.data.rationale); // → "Strong match on …"
```

## Testing

```bash
npm test
```

Tests use Jest with ts-jest in ESM mode. On Windows, the test script runs Node.js directly (`node --experimental-vm-modules`) instead of using the `.bin/jest` shim.

To inject a custom delay and avoid real `setTimeout` calls in tests:

```typescript
const delays: number[] = [];
const mockDelay = async (ms: number) => { delays.push(ms); };
const gateway = new LLMGateway(config, mockDelay);
```

## Building

```bash
npm run build
```

The build outputs ESM files, declaration files, and source maps to `dist/`.

## Licence

MIT
