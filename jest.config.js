// Set NODE_ENV before any module is loaded
process.env.NODE_ENV = 'test';

module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],

  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60
    }
  },

  // Files to collect coverage from
  collectCoverageFrom: [
    'Task/**/*.js',
    'IMAP/**/*.js',
    'BrowserPool/**/*.js',
    'Session/**/*.js',
    'Dashboard/statusManager/**/*.js',
    'Dashboard/utils/**/*.js',
    'Sheets/**/*.js',
    'Logs/**/*.js',
    'utils/**/*.js',
    'Exec/execAccept.js',
    'Config/**/*.js',
    'Features/**/*.js',
    'Core/**/*.js',
    'State/**/*.js',
    '!**/node_modules/**',
    '!**/__tests__/**',
    '!**/coverage/**',
    '!**/Backup/**',
    '!**/*-Backup.js',
    '!**/*_*.js',
    '!**/*BackUp*',
    '!**/LoginSession/**',
    '!**/Google/**',
    '!**/Dashboard/server.js',
    '!**/Dashboard/dashboardPusher.js',
    '!**/Exec/clickHelper.js',
    '!**/IMAP/retryHandler.js'
  ],

  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],

  // Ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/'
  ],

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],

  // Module paths
  moduleDirectories: ['node_modules', '<rootDir>'],

  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Verbose output
  verbose: true,

  // Timeout for tests (increase for async operations)
  testTimeout: 10000
};
