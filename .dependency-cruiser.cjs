// Architecture rules for the TypeScript workspaces (`npm run lint:deps`). Layering, bottom-up:
// shared <- ui <- {engine, admin}; test-support is test-only. functions/ joins in M2 with its own rules.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
    forbidden: [
        {
            name: 'no-circular',
            severity: 'error',
            comment: 'Cycles make modules impossible to test in isolation.',
            from: {},
            to: { circular: true },
        },
        {
            name: 'not-to-unresolvable',
            severity: 'error',
            comment: 'Every import must resolve (catches typos and missing dependencies).',
            from: {},
            to: { couldNotResolve: true },
        },
        {
            name: 'no-non-package-json',
            severity: 'error',
            comment: 'Product code may only import packages its package.json declares (no phantom dependencies).',
            from: { path: '^packages/[^/]+/src/' },
            to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
        },
        {
            name: 'src-not-to-dev-dependencies',
            severity: 'error',
            comment: 'Product code ships; devDependencies (test helpers, tooling) must not end up in a bundle.',
            from: { path: '^packages/[^/]+/src/', pathNot: '^packages/test-support/' },
            to: { dependencyTypes: ['npm-dev'] },
        },
        {
            name: 'src-not-to-tests',
            severity: 'error',
            comment: 'Product code never imports tests or the test-support package.',
            from: { path: '^packages/[^/]+/src/', pathNot: '^packages/test-support/' },
            to: { path: ['^packages/[^/]+/test/', '^packages/test-support/'] },
        },
        {
            name: 'shared-is-environment-neutral',
            severity: 'error',
            comment: 'shared runs in the browser, in Cloud Functions and in tests: no UI, no Lit, no Mapbox.',
            from: { path: '^packages/shared/' },
            to: { path: ['^packages/(ui|engine|admin|test-support)/', 'node_modules/(lit|lit-html|@lit|mapbox-gl)/'] },
        },
        {
            name: 'ui-below-apps',
            severity: 'error',
            comment: 'The component kit is shared by engine and admin, so it cannot depend on either.',
            from: { path: '^packages/ui/' },
            to: { path: '^packages/(engine|admin)/' },
        },
        {
            name: 'engine-and-admin-independent',
            severity: 'error',
            comment: 'The public engine never ships admin code, and the admin reuses engine pieces only via shared/ui.',
            from: { path: '^packages/(engine|admin)/' },
            to: { path: '^packages/(engine|admin)/', pathNot: '^packages/$1/' },
        },
        {
            name: 'only-the-map-adapter-imports-mapbox',
            severity: 'error',
            comment: 'Mapbox GL is reached only through engine/src/map/mapbox-adapter.ts (MapPort), so the core is testable with FakeMap.',
            from: { pathNot: '^packages/engine/src/map/mapbox-adapter\\.ts$' },
            to: { path: 'node_modules/mapbox-gl/' },
        },
    ],
    options: {
        doNotFollow: { path: 'node_modules' },
        exclude: { path: ['(^|/)\\.tsbuild/', '(^|/)dist/'] },
        tsPreCompilationDeps: true,
        tsConfig: { fileName: 'tsconfig.json' },
        enhancedResolveOptions: {
            exportsFields: ['exports'],
            conditionNames: ['import', 'require', 'node', 'default', 'types'],
            mainFields: ['module', 'main', 'types', 'typings'],
        },
        reporterOptions: {
            text: { highlightFocused: true },
        },
    },
};
