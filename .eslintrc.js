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
