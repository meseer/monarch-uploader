import js from '@eslint/js';
import globals from 'globals';
import importPlugin from 'eslint-plugin-import';

export default [
  // Base configuration
  js.configs.recommended,
  
  // Global configuration
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.jest,
        ...globals.node,
        // Test environment globals
        global: 'writable',
        require: 'readonly',
        // Tampermonkey globals
        GM_addElement: 'readonly',
        GM_deleteValue: 'readonly',
        GM_download: 'readonly',
        GM_getValue: 'readonly',
        GM_listValues: 'readonly',
        GM_log: 'readonly',
        GM_registerMenuCommand: 'readonly',
        GM_setValue: 'readonly',
        GM_xmlhttpRequest: 'readonly',
        // Browser globals
        unsafeWindow: 'readonly',
      },
    },
    
    plugins: {
      import: importPlugin,
    },
    
    rules: {
      // Import plugin rules (subset of Airbnb rules)
      'import/order': ['error', { groups: [['builtin', 'external', 'internal']] }],
      'import/no-mutable-exports': 'error',
      'import/no-commonjs': 'off',
      'import/no-amd': 'error',
      'import/first': 'error',
      'import/no-duplicates': 'error',
      'import/extensions': ['error', 'ignorePackages', {
        js: 'never',
        mjs: 'never',
        jsx: 'never',
      }],
      'import/newline-after-import': 'error',
      'import/no-absolute-path': 'error',
      'import/no-dynamic-require': 'error',
      'import/no-webpack-loader-syntax': 'error',
      'import/no-named-default': 'error',
      'import/no-self-import': 'error',
      'import/no-useless-path-segments': 'error',
      'import/prefer-default-export': 'off',
      
      // Best practices (similar to Airbnb)
      'array-callback-return': 'error',
      'block-scoped-var': 'error',
      'consistent-return': 'error',
      'curly': ['error', 'multi-line'],
      'default-case': 'error',
      'dot-notation': 'error',
      'eqeqeq': ['error', 'always'],
      'guard-for-in': 'error',
      'no-caller': 'error',
      'no-else-return': 'error',
      'no-empty-function': 'off', // Allow empty functions
      'no-eval': 'error',
      'no-extend-native': 'error',
      'no-extra-bind': 'error',
      'no-floating-decimal': 'error',
      'no-implicit-coercion': 'off', // Allow implicit coercion
      'no-implicit-globals': 'error',
      'no-implied-eval': 'error',
      'no-invalid-this': 'off', // Allow this in various contexts
      'no-iterator': 'error',
      'no-labels': 'error',
      'no-lone-blocks': 'error',
      'no-loop-func': 'error',
      'no-multi-spaces': 'error',
      'no-multi-str': 'error',
      'no-new': 'error',
      'no-new-func': 'error',
      'no-new-wrappers': 'error',
      'no-octal-escape': 'error',
      'no-proto': 'error',
      'no-return-assign': 'error',
      'no-return-await': 'error',
      'no-script-url': 'error',
      'no-self-compare': 'error',
      'no-sequences': 'error',
      'no-throw-literal': 'error',
      'no-unmodified-loop-condition': 'off', // Allow unmodified loop conditions
      'no-unused-expressions': 'error',
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-useless-return': 'error',
      'no-void': 'error',
      'no-with': 'error',
      'prefer-promise-reject-errors': 'error',
      'radix': 'error',
      'vars-on-top': 'error',
      'wrap-iife': 'error',
      'yoda': 'error',
      
      // Variables
      'no-shadow': 'error',
      'no-shadow-restricted-names': 'error',
      'no-undef-init': 'error',
      
      // Style (basic)
      'comma-dangle': ['error', 'always-multiline'],
      'comma-spacing': 'error',
      'comma-style': 'error',
      'func-call-spacing': 'error',
      'indent': ['error', 2],
      'key-spacing': 'error',
      'keyword-spacing': 'error',
      'no-array-constructor': 'error',
      'no-mixed-spaces-and-tabs': 'error',
      'no-multiple-empty-lines': ['error', { max: 1 }],
      'no-new-object': 'error',
      'no-tabs': 'error',
      'no-trailing-spaces': 'error',
      'no-underscore-dangle': 'error',
      'no-whitespace-before-property': 'error',
      'object-curly-spacing': ['error', 'always'],
      'one-var': ['error', 'never'],
      'padded-blocks': ['error', 'never'],
      'quote-props': ['error', 'as-needed'],
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      'semi-spacing': 'error',
      'space-before-blocks': 'error',
      'space-before-function-paren': ['error', {
        anonymous: 'always',
        named: 'never',
        asyncArrow: 'always',
      }],
      'space-in-parens': 'error',
      'space-infix-ops': 'error',
      'space-unary-ops': 'error',
      'spaced-comment': 'error',
      
      // ES6
      'arrow-body-style': ['error', 'as-needed'],
      'arrow-parens': ['error', 'always'],
      'arrow-spacing': 'error',
      'constructor-super': 'error',
      'generator-star-spacing': 'error',
      'no-class-assign': 'error',
      'no-confusing-arrow': 'error',
      'no-const-assign': 'error',
      'no-dupe-class-members': 'error',
      'no-duplicate-imports': 'error',
      'no-new-symbol': 'error',
      'no-this-before-super': 'error',
      'no-useless-computed-key': 'error',
      'no-useless-constructor': 'error',
      'no-useless-rename': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-const': ['error', { 
        'destructuring': 'all',
        'ignoreReadBeforeAssign': true
      }],
      'prefer-destructuring': 'off', // Too strict for existing code
      'prefer-numeric-literals': 'error',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'prefer-template': 'error',
      'require-yield': 'error',
      'rest-spread-spacing': 'error',
      'symbol-description': 'error',
      'template-curly-spacing': 'error',
      'yield-star-spacing': 'error',
      
      // Rules for Tampermonkey scripts (overrides)
      'no-unused-vars': ['error', { 
        'vars': 'all', 
        'args': 'after-used',
        'argsIgnorePattern': '^(e|error|_)', // Allow common unused params
        'caughtErrors': 'none', // Don't check catch block errors
        // Allow GM_* functions to be declared as global
        'varsIgnorePattern': '^GM_'
      }],
      'camelcase': 'off', // Allow GM_* function names
      'no-undef': ['error', { 'typeof': true }],
      
      // Project-specific exceptions
      'max-len': 'off', // Disabled - too restrictive for this project
      'no-use-before-define': ['error', { 'functions': false }],
      'no-param-reassign': 'off', // Common in DOM manipulation
      'no-console': 'off', // Allow console logs
      'no-plusplus': 'off', // Allow ++ and -- operators
      
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
  },
  
  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '*.config.js',
      'webpack.config.js',
      'jest.config.js',
      '.eslintrc.js',
      'src/userscript-metadata.js', // Has specific CommonJS exports
    ],
  },
];
