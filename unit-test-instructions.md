# Unit Test Instructions

## Exact command

```sh
cd forge-llm-gateway && node --experimental-vm-modules node_modules/jest/bin/jest.js --testPathPattern="src/__tests__/llm-gateway.test.ts" --verbose
```

On Windows PowerShell:

```powershell
Set-Location "D:\Resume-Harness-V3\forge-llm-gateway"
node --experimental-vm-modules "node_modules\jest\bin\jest.js" --testPathPattern="src/__tests__/llm-gateway.test.ts" --verbose
```

Via npm script:

```sh
cd forge-llm-gateway && npm test
```

## Notes

- Requires Node.js ≥ 18 with `--experimental-vm-modules` flag for ESM + Jest
- `isolatedModules: true` is set in the ts-jest transform config (required for NodeNext ESM)
- All 13 tests run in under 1 second; no real network calls
