module.exports = {
  env: {
    browser: true,
    es2021: true,
    jest: true,
  },
  extends: [
    'airbnb-base',
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
  },
  rules: {
    // Rules for Tampermonkey scripts
    'no-unused-vars': ['error', { 
      'vars': 'all', 
      'args': 'after-used',
      // Allow GM_* functions to be declared as global
      'varsIgnorePattern': '^GM_'
    }],
    'camelcase': 'off', // Allow GM_* function names
    'no-undef': ['error', { 'typeof': true }],
    
    // Project-specific exceptions
    'max-len': ['warn', { 'code': 120 }],
    'no-use-before-define': ['error', { 'functions': false }],
    'no-param-reassign': 'off', // Common in DOM manipulation
    'no-console': 'off', // Allow console logs
    
    // Relaxed rules for userscript development
    'max-classes-per-file': 'off', // Allow multiple classes per file
    'import/no-named-as-default-member': 'off', // Allow named imports from default exports
    'import/no-cycle': 'off', // Allow circular dependencies (common in userscripts)
    'no-await-in-loop': 'off', // Allow await in loops for sequential processing
    'no-restricted-syntax': 'off', // Allow for/of loops and other syntax
    'class-methods-use-this': 'off', // Allow methods that don't use this
    'no-promise-executor-return': 'off', // Allow return in promise executors
    'brace-style': 'off', // Allow flexible brace styles
    'no-continue': 'off', // Allow continue statements
    'no-alert': 'warn', // Warn but don't error on alerts
  },
  globals: {
    // Tampermonkey globals
    'GM_addElement': 'readonly',
    'GM_deleteValue': 'readonly',
    'GM_download': 'readonly',
    'GM_getValue': 'readonly',
    'GM_listValues': 'readonly',
    'GM_log': 'readonly',
    'GM_registerMenuCommand': 'readonly',
    'GM_setValue': 'readonly',
    'GM_xmlhttpRequest': 'readonly',
    
    // Browser globals
    'unsafeWindow': 'readonly',
  },
};
