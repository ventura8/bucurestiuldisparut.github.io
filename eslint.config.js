// ESLint flat config: the single place where lint rules are chosen or relaxed. Inline directive
// comments are disabled (linterOptions.noInlineConfig, --no-inline-config) and banned by
// scripts/ci/check_no_inline_suppressions.py; a relaxation goes here, scoped and with a why-comment.
import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import lit from 'eslint-plugin-lit';
import nounsanitized from 'eslint-plugin-no-unsanitized';
import sonarjs from 'eslint-plugin-sonarjs';
import wc from 'eslint-plugin-wc';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Product source of every workspace package (functions/src joins in M2). */
const PRODUCT = ['packages/*/src/**/*.ts', 'functions/src/**/*.ts'];
const TESTS = ['packages/*/test/**/*.ts', 'packages/test-support/src/**/*.ts', 'functions/test/**/*.ts', 'firebase/rules-tests/**/*.ts'];
const NODE_TOOLING = ['*.config.ts', 'packages/*/vite.config.ts', 'eslint.config.js', '.dependency-cruiser.cjs'];

/** XSS: data is never rendered as HTML (docs/research/design-review-security-cost.md §1.7). */
const HTML_SINKS = [
    { property: 'innerHTML', message: 'Render with Lit templates or textContent; data is never HTML (security review §1.7).' },
    { property: 'outerHTML', message: 'Render with Lit templates or textContent; data is never HTML (security review §1.7).' },
    { property: 'insertAdjacentHTML', message: 'Build DOM nodes instead; data is never HTML (security review §1.7).' },
    { property: 'setHTML', message: 'Mapbox popups use setDOMContent; data is never HTML (security review §1.7).' },
    { property: 'setHTMLUnsafe', message: 'Data is never HTML (security review §1.7).' },
    { object: 'document', property: 'write', message: 'document.write is banned (CSP, XSS).' },
    { object: 'document', property: 'writeln', message: 'document.writeln is banned (CSP, XSS).' },
];

const UNSAFE_LIT_DIRECTIVES = {
    patterns: [
        {
            group: ['lit/directives/unsafe-*', 'lit-html/directives/unsafe-*'],
            message: 'unsafeHTML/unsafeSVG/unsafeMathML render strings as markup; data is never HTML (security review §1.7).',
        },
    ],
};

const BANNED_SYNTAX = [
    {
        selector: 'Decorator',
        message: 'Decorators are banned: use `static properties` + customElements.define (their helpers show as uncovered branches).',
    },
    {
        selector: 'Identifier[name=/^unsafe(HTML|SVG|MathML)$/]',
        message: 'unsafeHTML/unsafeSVG/unsafeMathML render strings as markup; data is never HTML (security review §1.7).',
    },
    { selector: 'NewExpression[callee.name="Function"]', message: 'new Function is eval; banned (CSP, XSS).' },
    { selector: 'CallExpression[callee.name="Function"]', message: 'Function() is eval; banned (CSP, XSS).' },
];

/** Size and complexity limits for product code (complexity 5 = Radon A, the sibling repos' bar). */
const PRODUCT_LIMITS = {
    complexity: ['error', 5],
    'max-depth': ['error', 3],
    'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
    'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
    'max-params': ['error', 4],
    'sonarjs/cognitive-complexity': ['error', 10],
};

export default defineConfig(
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.tsbuild/**',
            'reports/**',
            'coverage/**',
            'playwright-report/**',
            'test-results/**',
            'seed/**',
            // Third-party code vendored only to patch an advisory (vendor/npm/braces/README.md); not ours to lint.
            'vendor/**',
        ],
    },
    {
        linterOptions: {
            noInlineConfig: true,
            reportUnusedDisableDirectives: 'error',
            reportUnusedInlineConfigs: 'error',
        },
    },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    sonarjs.configs.recommended,
    nounsanitized.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            eqeqeq: ['error', 'always'],
            'no-console': 'error',
            'no-eval': 'error',
            'no-new-func': 'error',
            'no-var': 'error',
            'prefer-const': 'error',
            'no-restricted-properties': ['error', ...HTML_SINKS],
            'no-restricted-imports': ['error', UNSAFE_LIT_DIRECTIVES],
            'no-restricted-syntax': ['error', ...BANNED_SYNTAX],
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
        },
    },
    {
        files: PRODUCT,
        languageOptions: { globals: globals.browser },
        rules: PRODUCT_LIMITS,
    },
    {
        files: ['packages/ui/src/**/*.ts', 'packages/engine/src/**/*.ts', 'packages/admin/src/**/*.ts'],
        extends: [lit.configs['flat/recommended'], wc.configs['flat/recommended']],
    },
    {
        // The logging module is the one place allowed to write to the console: every other
        // module logs through createLogger() (packages/shared/src/log.ts).
        files: ['packages/shared/src/log.ts'],
        rules: { 'no-console': 'off' },
    },
    {
        files: TESTS,
        extends: [vitest.configs.recommended],
        languageOptions: { globals: { ...globals.browser, ...globals.node } },
        rules: {
            'vitest/no-focused-tests': 'error',
            'vitest/no-disabled-tests': 'error',
            'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'expect.element'] }],
            'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
            'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
            'max-params': ['error', 8],
        },
    },
    {
        files: NODE_TOOLING,
        languageOptions: { globals: globals.node },
    },
    {
        // Plain JavaScript files here are tool configs (eslint, dependency-cruiser): they are not part of
        // any tsconfig project, so type-aware rules cannot run on them (typescript-eslint's documented setup).
        files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
        extends: [tseslint.configs.disableTypeChecked],
    },
    {
        // dependency-cruiser only reads CommonJS configs (`module.exports`).
        files: ['**/*.cjs'],
        languageOptions: { sourceType: 'commonjs' },
    },
    prettier,
);
