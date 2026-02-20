process.env.TZ = 'America/Vancouver';

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
  
  // Coverage is now handled by c8, not Jest
  collectCoverage: false,
  
  // Setup files to run before each test
  setupFilesAfterEnv: [
    '<rootDir>/test/setup.js'
  ],
  
  // Mock Tampermonkey GM_ functions are set up in setup.js
  globals: {},
  
  // Display individual test results
  verbose: true
};
