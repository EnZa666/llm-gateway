# llm-gateway

A TypeScript library that wraps the [Vercel AI SDK](https://sdk.vercel.ai/) with automatic
retry, response telemetry, filler-text stripping, and output compliance rules.

All agent configuration — provider, model, system prompt, compliance rules — lives in a JSON
file. Swap providers or tune prompts without touching code.

## Install

```bash
npm install llm-gateway ai zod @ai-sdk/anthropic
```

**Peer dependencies:** `ai >= 4.0.0`, `zod >= 3.0.0`

Install at least one provider: `@ai-sdk/anthropic >= 1.0.0` or `@ai-sdk/openai >= 1.0.0`

**Requires:** Node.js ≥ 18 (ESM), TypeScript ≥ 5.3

---

## Quick start — config file

Define your agents in a JSON file. No code changes needed to add agents, swap providers, or
update prompts.

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

### Loading from an environment variable

Useful in containerised deployments — no config file on disk needed:

```bash
export LLM_GATEWAY_CONFIG='{"agents": {"my-agent": { ... }}}'
```

```typescript
const loader = GatewayConfigLoader.fromEnv(); // reads LLM_GATEWAY_CONFIG
```

### Using a different env var name

```typescript
const loader = GatewayConfigLoader.fromEnv('MY_AGENTS_CONFIG');
```

---

## Quick start — direct API

You can also construct a gateway directly without a config file:

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

LangChain and CrewAI solve orchestration — multi-step pipelines, memory, tool chaining. For
applications that make one agent call per user action, that machinery is overhead, and the raw
provider SDKs push retry logic, token accounting, and compliance filtering into every call
site. `llm-gateway` sits between them.

All agent configuration — provider, model, instructions, rules — lives in a JSON file read at
runtime, so changing a system prompt, swapping from Claude to GPT, or adjusting temperature
is a config edit rather than a rebuild.

The gateway itself has a single job: take instructions in, return text or a structured object
out. It has no file system access and no knowledge of what called it. Your application owns
data fetching, context assembly, and what to do with the result.

Retry on rate limits, output compliance rules, filler-text stripping, and token telemetry
behave the same way for every agent call. Putting them in a shared layer means individual call
sites stay clean and the behaviour doesn't drift as you add agents.

---

## What it covers

- **Provider switching** — change `provider_package` and `provider_factory_method` in config; no code changes
- **JSON config** — load agent settings from a file, an env var, or a plain object
- **Instruction templates** — define `{{variable}}` placeholders in config; fill them at call time
- **Typed errors** — every failure maps to a `GatewayErrorCode`; `switch` on it without inspecting raw HTTP
- **Automatic retry** — exponential backoff with jitter for rate limits and server errors (3 attempts; 2 s, 4 s, 8 s)
- **Response telemetry** — every call returns `tokensConsumedInput`, `tokensConsumedOutput`, and `executionDurationMs`
- **Output compliance** — define `REPLACE` or `REJECT` rules per agent in config; `REPLACE` runs before `REJECT`
- **Filler-text stripping** — leading and trailing AI filler phrases are removed from text responses

---

## API

### `GatewayConfigLoader`

| Method | Returns | Description |
|---|---|---|
| `fromObject(config)` | `GatewayConfigLoader` | Load from a plain object — validates the config |
| `fromFile(path)` | `Promise<GatewayConfigLoader>` | Load from a JSON file — validates the config |
| `fromEnv(varName?)` | `GatewayConfigLoader` | Load from an env var (default: `LLM_GATEWAY_CONFIG`) — validates the config |
| `get(agentName)` | `ConfiguredLLMGateway` | Look up a named agent; throws if not found |
| `agents()` | `string[]` | List all defined agent names |

All three factory methods run the same Zod schema validation. Invalid `provider_package`
values (path traversal, Node.js built-in modules), invalid `provider_factory_method`
identifiers, and `pattern` strings exceeding 500 characters are rejected at load time with
a clear error message.

---

### `ConfiguredLLMGateway`

Returned by `loader.get(name)`. System rules and compliance rules are pre-bound from the
agent's definition.

#### `executeTextTask(instructionsOrVariables, contextPayload?)`

- Pass a `string` to use as instructions directly.
- Pass a `Record<string, string>` to fill the agent's `instruction_template`. Throws if a referenced variable is missing or no template is defined.
- `contextPayload` is appended to the user message (optional, defaults to `''`).
- Returns `GatewayResponseEnvelope<string>`.

#### `executeStructuredTask<T>(instructionsOrVariables, validationSchema, contextPayload?)`

Same instruction resolution as above. Returns `GatewayResponseEnvelope<T>`.

---

### `new LLMGateway(config, delayFn?)`

| Param | Type | Description |
|---|---|---|
| `config` | `PhaseRuntimeConfig` | Provider and model configuration |
| `delayFn` | `(ms: number) => Promise<void>` | Override the retry delay (useful in tests) |

#### `executeTextTask(systemRules, instructions, contextPayload, complianceRules?)`

Calls the provider and returns `GatewayResponseEnvelope<string>`. Filler text is stripped;
compliance rules are applied in order.

#### `executeStructuredTask<T>(systemRules, instructions, contextPayload, validationSchema)`

Calls the provider with a Zod schema and returns `GatewayResponseEnvelope<T>`. Throws
`SCHEMA_VALIDATION_FAILED` when the model's output does not match the schema, and
`OUTPUT_TRUNCATED_BY_LIMIT` when generation stopped at the token limit.

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
  model_identifier: string;         // e.g. 'claude-sonnet-4-5'
  settings?: {
    temperature?: number;
    max_tokens?: number;
  };
  system_rules: string;
  compliance_rules?: SerializedComplianceRule[];
  instruction_template?: string;    // Uses {{variable}} placeholders
}
```

#### `SerializedComplianceRule`

JSON-safe compliance rule (RegExp expressed as a string):

```typescript
interface SerializedComplianceRule {
  ruleId: string;
  type: 'REPLACE' | 'REJECT';
  pattern: string;           // RegExp source, e.g. "\\bdelve\\b" — max 500 chars
  flags?: string;            // RegExp flags, e.g. "gi"
  replacementValue?: string; // required when type === 'REPLACE'
  customErrorMessage?: string;
}
```

> **Note:** `pattern` is capped at 500 characters. Longer patterns are rejected at
> config-load time to prevent catastrophic-backtracking (ReDoS) attacks.

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

`REPLACE` rules run before `REJECT` rules. In `AgentDefinition`, use `SerializedComplianceRule`
(pattern as a string); `ConfiguredLLMGateway` compiles them to `RegExp` on construction.

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
| `DYNAMIC_IMPORT_FAILED` | Provider package could not be loaded |
| `PROVIDER_AUTHENTICATION_ERROR` | HTTP 401 / 403 |
| `PROVIDER_RATE_LIMIT_EXCEEDED` | HTTP 429 (rate limit; retried) |
| `PROVIDER_QUOTA_EXHAUSTED` | HTTP 402 or quota/billing 429 |
| `CONTEXT_WINDOW_EXCEEDED` | HTTP 400 with context/length signal |
| `PROVIDER_SERVER_ERROR` | HTTP 5xx or unclassified 400 (retried) |
| `SCHEMA_VALIDATION_FAILED` | Zod parse error on structured output |
| `OUTPUT_TRUNCATED_BY_LIMIT` | `finishReason === 'length'` |
| `STATUTORY_RULE_VIOLATION` | A `REJECT` compliance rule matched |
| `CONFIGURATION_ERROR` | Invalid `provider_package` or `provider_factory_method`; missing `instruction_template`; unresolved template variable |

All errors are instances of `ForgeGatewayError`, which extends `Error` with an
`errorCode: GatewayErrorCode` property.

---

## Retry behaviour

Retries fire for `PROVIDER_RATE_LIMIT_EXCEEDED` and `PROVIDER_SERVER_ERROR` only — up to 3
attempts with delays of 2 s, 4 s, 8 s plus up to 1 s of random jitter. All other error codes
throw immediately.

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

Tests use Jest with ts-jest in ESM mode. On Windows, the test script invokes Node.js directly
(`node --experimental-vm-modules`) rather than the `.bin/jest` shim.

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

Output goes to `dist/` as ESM with declaration files and source maps.

## Licence

MIT
