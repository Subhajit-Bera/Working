module.exports = {
  ...require('./jest.config'),
  testMatch: ['**/tests/integration/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/integration/setup.ts'],
  testTimeout: 30000,
};
