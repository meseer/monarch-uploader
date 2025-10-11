module.exports = {
  // The root directory that Jest should scan for tests
  rootDir: '.',
  
  // The test environment that will be used
  testEnvironment: 'jsdom',
  
  // A list of paths to directories that Jest should use to search for files in
  roots: [
    '<rootDir>/src/',
    '<rootDir>/test/'
  ],
  
  // Files to match for tests
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)(spec|test).js'
  ],
  
  // File extensions Jest will look for
  moduleFileExtensions: [
    'js',
    'json'
  ],
  
  // Transform files with babel-jest
  transform: {
    '^.+\\.js$': 'babel-jest'
  },
  
  // Coverage settings
  collectCoverageFrom: [
    'src/**/*.js',
    '!**/node_modules/**',
    '!**/vendor/**'
  ],
  
  // Coverage output settings
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html'
  ],
  
  // Coverage thresholds (optional - can be adjusted)
  coverageThreshold: {
    global: {
      branches: 0, // Start with 0, increase as coverage improves
      functions: 0,
      lines: 0,
      statements: 0
    }
  },
  
  // Setup files to run before each test
  setupFilesAfterEnv: [
    '<rootDir>/test/setup.js'
  ],
  
  // Mock Tampermonkey GM_ functions are set up in setup.js
  globals: {},
  
  // Display individual test results
  verbose: true
};
