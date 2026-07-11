'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'package-lock.json'] },
  js.configs.recommended,
  {
    rules: {
      // catch vazio é padrão do projeto (ambientes sem localStorage/pointer lock etc.)
      'no-empty': ['error', { allowEmptyCatch: true }],
      // args não usados são comuns em callbacks (dt, t); variável morta é erro
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['server.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    files: ['game.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
    },
  },
  {
    files: ['multiplayer-client.js', 'br-game.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: globals.browser,
    },
  },
];
