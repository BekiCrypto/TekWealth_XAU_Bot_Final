import js from '@eslint/js';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.bolt'] }, // Added node_modules and .bolt to ignores
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react': reactPlugin,
      'react-hooks': reactHooksPlugin,
      'react-refresh': reactRefreshPlugin,
      'jsx-a11y': jsxA11yPlugin,
    },
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module', // Recommended for modern JS
      globals: {
        ...globals.browser,
        ...globals.es2020, // Add modern ES features
      },
      parserOptions: { // Required for typescript-eslint
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect', // Automatically detect the React version
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules, // For new JSX transform
      ...reactHooksPlugin.configs.recommended.rules,
      ...jsxA11yPlugin.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Example: Disable a rule if needed, or adjust severity
      // 'react/prop-types': 'off', // Often not needed with TypeScript
      'no-unused-vars': 'warn', // More lenient than error during development
      '@typescript-eslint/no-unused-vars': 'warn', // For TS files
      '@typescript-eslint/explicit-module-boundary-types': 'off', // Can be verbose
    },
  }
);
