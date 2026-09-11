const js = require('@eslint/js');
const globals = require('globals');
const importPlugin = require('eslint-plugin-import');

const baseStyleRules = {
  'prefer-const': 'warn',
  quotes: ['warn', 'single', { avoidEscape: true }],
  semi: ['warn', 'always'],
  'comma-dangle': ['warn', 'never'],
  'object-curly-spacing': ['warn', 'always'],
  'no-trailing-spaces': 'warn',
  'eol-last': ['warn', 'always']
};

const baseImportRules = {
  'import/no-duplicates': 'warn',
  'import/newline-after-import': 'warn',
  'import/order': [
    'warn',
    {
      'newlines-between': 'always',
      alphabetize: { order: 'asc', caseInsensitive: true }
    }
  ]
};

module.exports = [
  {
    ignores: ['node_modules/**', '.wrangler/**', 'coverage/**', 'dist/**', '**/*.min.js']
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'public/js/**/*.js'],
    rules: {
      // 渐进收敛：先以 warning 形式暴露存量问题，后续再逐步提升为 error
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none'
        }
      ],
      'no-control-regex': 'warn',
      'no-regex-spaces': 'warn'
    }
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.es2024,
        ...globals.worker,
        ...globals.serviceworker
      }
    },
    plugins: {
      import: importPlugin
    },
    rules: {
      'no-console': 'off',
      ...baseStyleRules,
      ...baseImportRules
    }
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.es2024,
        ...globals.browser,
        Alpine: 'readonly'
      }
    },
    plugins: {
      import: importPlugin
    },
    rules: {
      'no-console': 'off',
      ...baseStyleRules,
      ...baseImportRules
    }
  }
];
