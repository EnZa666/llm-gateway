# Contributing

## Setup

```bash
cd llm-gateway
npm install
npm run build
npm test
```

## Running tests

```bash
npm test
```

Tests run with Jest in ESM mode. On Windows, the `.bin/jest` shim has a bash shebang that Git Bash cannot execute. Invoke Jest directly instead:

```bash
node --experimental-vm-modules node_modules/jest-cli/bin/jest.js
```

## Project structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for a full walkthrough of the design.

## Adding a provider

No library changes are needed. Pass the provider's package name and factory method in `PhaseRuntimeConfig`:

```typescript
{
  provider_package: '@ai-sdk/google',
  provider_factory_method: 'google',
  model_identifier: 'gemini-2.0-flash',
}
```

Install the provider as a peer dependency in the consuming app.

## Adding a new error code

1. Add the string literal to the `GatewayErrorCode` union in `src/types.ts`.
2. Map to it in `mapProviderError()` in `src/llm-gateway.ts`.
3. Add a test case in `src/__tests__/llm-gateway.test.ts`.
4. Document it in `README.md` under "GatewayErrorCode".

## Releases

Build before publishing:

```bash
npm run build
npm publish
```

The `files` field in `package.json` restricts the published package to `dist/`.
