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
      // testes de jogabilidade rodam trechos dentro do navegador (page.evaluate)
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['game.js', 'js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
    },
  },
  {
    files: ['js/minimap-worker.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: globals.worker,
    },
  },
  {
    files: ['multiplayer-client.js', 'br-game.js', 'city-destruction-client.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: globals.browser,
    },
  },
  {
    // UMD: roda no navegador (window) e no node (module.exports)
    files: ['city-destruction-protocol.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      // stress.js injeta trechos no navegador (page.evaluate), como test/
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
