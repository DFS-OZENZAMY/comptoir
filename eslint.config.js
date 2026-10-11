// Vérification automatique du code (npm run lint). Règles volontairement simples :
// elles attrapent les vraies erreurs (variable inconnue, code inaccessible…) sans imposer de style.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'public/vendor/', 'data/', '.wrangler/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.serviceworker } },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser } },
  },
  { files: ['public/app/sw.js'], languageOptions: { globals: { ...globals.serviceworker } } },
  // Objets fournis par Cloudflare Workers (Durable Objects, WebSockets en veille).
  { files: ['src/adapters/cloudflare.js'], languageOptions: { globals: { WebSocketPair: 'readonly', WebSocketRequestResponsePair: 'readonly' } } },
  {
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
      'no-useless-escape': 'warn',
    },
  },
];
