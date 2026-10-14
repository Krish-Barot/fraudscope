// apps/api/jest.config.js
/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  testTimeout: 30000,
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        strict: false,
      },
    }],
  },
  clearMocks: true,
  restoreMocks: true,
  verbose: true,
  detectOpenHandles: true,
  globalTeardown: '<rootDir>/tests/helpers/globalTeardown.ts',
};

module.exports = config;