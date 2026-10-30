export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          // Required for ts-jest ESM + NodeNext hybrid mode.
          // Enables per-file transformation without full program type checking.
          isolatedModules: true,
        },
      },
    ],
  },
  testMatch: ['**/src/__tests__/**/*.test.ts'],
};
