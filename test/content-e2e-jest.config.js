/** @type {import('jest').Config} */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: 'test/content/.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  globalSetup: '<rootDir>/test/schema/global-setup.ts',
  testTimeout: 30000,
  maxWorkers: 1,
};
