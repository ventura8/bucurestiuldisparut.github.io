import { describe, expect, it } from 'vitest';

import {
    ADMIN_EVENT_PARAMS,
    FIELD_EVENT_BUDGET,
    VIEWER_EVENT_PARAMS,
    createAdminGuard,
    createViewerGuard,
    eventProblem as problemIn,
    eventSchemas,
    type GaParams,
} from '../../src/index.js';

const PAGE = 'https://bucurestiul-disparut.web.app/';
const CONTEXT = { app: 'viewer', window_class: 'compact', release: '1.2.0', page_location: PAGE } as const;

const BOTH = eventSchemas({ ...VIEWER_EVENT_PARAMS, ...ADMIN_EVENT_PARAMS, page_view: {} });
const eventProblem = (name: string, params: GaParams) => problemIn(BOTH, name, params);

/** One valid event of every name the apps send. */
const VALID: Readonly<Record<keyof typeof VIEWER_EVENT_PARAMS | keyof typeof ADMIN_EVENT_PARAMS, GaParams>> = {
    page_view: { page_location: PAGE },
    layer_toggle: { layer_id: 'corona-1966', visible: true, page_location: PAGE },
    year_change: { year: 'today', page_location: PAGE },
    photo_open: { photo_id: 'p-0042', page_location: PAGE },
    poi_open: { poi_id: 'poi-7', page_location: PAGE },
    share: { page_location: PAGE },
    compare_open: { page_location: PAGE },
    exception: { description: 'TypeError: x is undefined', fatal: false, page_location: PAGE },
    setup_step: { step: 'billing', state: 'ok', page_location: PAGE },
    legacy_import: { imported: 120, failed: 2, page_location: PAGE },
    web_vitals: {
        metric_name: 'LCP',
        metric_value: 1830,
        metric_delta: 1830,
        metric_id: 'v6-1730000000000-1234567890123',
        metric_rating: 'good',
        navigation_type: 'navigate',
        value: 1830,
        debug_target: 'hcm-map-viewer div>canvas.mapboxgl-canvas',
        debug_ttfb: 120.5,
        ...CONTEXT,
    },
    viewer_timing: { phase: 'map_idle', duration_ms: 2400, since_start_ms: 3100, ...CONTEXT },
    manifest_error: { code: 'error.manifest.notFound', retryable: true, ...CONTEXT },
    map_unavailable: { reason: 'unsupported', ...CONTEXT },
    map_errors: { error_kind: 'tile', error_count: 31, ...CONTEXT },
    photo_timing: { duration_ms: 640, outcome: 'ok', ...CONTEXT },
    compare_timing: { duration_ms: 1500, outcome: 'failed', ...CONTEXT },
    admin_ready: { duration_ms: 2100, restored: true, ...CONTEXT, app: 'admin' },
    setup_check: { step: 'provision', outcome: 'invalid', error_code: 'apiError.cloud.permission', duration_ms: 900, ...CONTEXT },
    install_build: { target: 'server', outcome: 'failed', duration_ms: 400_000, failed_step: 'functions', ...CONTEXT },
    provision_item: { item: 'iam', outcome: 'ok', ...CONTEXT },
    editor_save: { area: 'photos', operation: 'update', outcome: 'ok', duration_ms: 310, ...CONTEXT },
    job_done: { job_type: 'raster', status: 'succeeded', duration_ms: 3_600_000, ...CONTEXT },
};

describe('field events', () => {
    it('happyPath_everyEventOfTheAppsValidates', () => {
        const problems = Object.fromEntries(Object.entries(VALID).map(([name, params]) => [name, eventProblem(name, params)]));
        expect(problems).toEqual(Object.fromEntries(Object.keys(VALID).map((name) => [name, null])));
    });

    it('badPath_anUnknownOrOverlongNameIsRefused', () => {
        expect(eventProblem('first_visit', { page_location: PAGE })).toBe('name');
        expect(eventProblem('x'.repeat(41), {})).toBe('name');
        expect(eventProblem('Page_view', { page_location: PAGE })).toBe('name');
    });

    it('badPath_moreThan25ParametersAreRefused', () => {
        const params = Object.fromEntries(Array.from({ length: 26 }, (_, index) => [`p${String(index)}`, index]));
        expect(eventProblem('page_view', params)).toBe('size');
    });

    it('badPath_aHashACoordinateAnEmailOrATilePathIsRefused', () => {
        const exception = (description: string): GaParams => ({ description, fatal: false, page_location: PAGE });
        expect(eventProblem('exception', exception('at #15/44.43/26.10'))).toBe('privacy');
        expect(eventProblem('exception', exception('near 44.43012, 26.10031'))).toBe('privacy');
        expect(eventProblem('exception', exception('mail owner@example.org'))).toBe('privacy');
        expect(eventProblem('exception', exception('GET https://a.example.org/x?access_token=1'))).toBe('privacy');
        expect(eventProblem('exception', exception('404 https://api.mapbox.com/v4/x/14/9300/5800.png'))).toBe('privacy');
        expect(eventProblem('exception', exception('x'.repeat(101)))).toBe('privacy');
        expect(eventProblem('page_view', { page_location: `${PAGE}#15/44.4/26.1` })).toBe('schema');
    });

    it('badPath_anUnknownParameterOrAWrongValueIsRefused', () => {
        expect(eventProblem('viewer_timing', { ...VALID.viewer_timing, lat: 44 })).toBe('schema');
        expect(eventProblem('viewer_timing', { ...VALID.viewer_timing, duration_ms: -1 })).toBe('schema');
        expect(eventProblem('web_vitals', { ...VALID.web_vitals, debug_target: 'div.a b' })).toBeNull();
        expect(eventProblem('web_vitals', { ...VALID.web_vitals, debug_target: 'DIV[data-x]' })).toBe('schema');
        expect(eventProblem('web_vitals', { ...VALID.web_vitals, window_class: 'huge' })).toBe('schema');
    });

    it('happyPath_theGuardPassesAValidEventOn', () => {
        expect(createViewerGuard().check('photo_timing', VALID.photo_timing)).toEqual({ ok: true, params: VALID.photo_timing });
        expect(createAdminGuard().check('job_done', VALID.job_done)).toEqual({ ok: true, params: VALID.job_done });
        expect(createAdminGuard().check('page_view', { route: 'setup', page_location: PAGE })).toMatchObject({ ok: true });
    });

    it('badPath_eachAppsGuardKnowsOnlyItsOwnEvents', () => {
        expect(createViewerGuard().check('job_done', VALID.job_done)).toEqual({ ok: false, reason: 'name', first: true });
        expect(createAdminGuard().check('photo_timing', VALID.photo_timing)).toEqual({ ok: false, reason: 'name', first: true });
        expect(createViewerGuard().check('page_view', { route: 'setup', page_location: PAGE })).toMatchObject({ reason: 'schema' });
    });

    it('badPath_theGuardNamesEachReasonOnceAsTheFirst', () => {
        const guard = createViewerGuard();
        expect(guard.check('nope', {})).toEqual({ ok: false, reason: 'name', first: true });
        expect(guard.check('nope', {})).toEqual({ ok: false, reason: 'name', first: false });
        expect(guard.check('exception', { description: '#1', fatal: true, page_location: PAGE })).toEqual({
            ok: false,
            reason: 'privacy',
            first: true,
        });
    });

    it('badPath_aFloodIsCappedPerNameAndPerPage', () => {
        const guard = createViewerGuard();
        const limit = FIELD_EVENT_BUDGET.names['map_errors'] ?? 0;
        const results = Array.from({ length: limit + 5 }, () => guard.check('map_errors', VALID.map_errors));
        expect(results.filter((result) => result.ok)).toHaveLength(limit);
        expect(results.at(-1)).toEqual({ ok: false, reason: 'budget', first: false });

        const page = createAdminGuard();
        const sent = Array.from({ length: FIELD_EVENT_BUDGET.total + 10 }, (_, index) =>
            page.check(index % 2 === 0 ? 'editor_save' : 'job_done', index % 2 === 0 ? VALID.editor_save : VALID.job_done),
        );
        expect(sent.filter((result) => result.ok)).toHaveLength(FIELD_EVENT_BUDGET.perName * 2);
        const many = createAdminGuard();
        const names = ['editor_save', 'job_done', 'legacy_import', 'setup_step'] as const;
        const all = Array.from({ length: 400 }, (_, index) => {
            const name = names[index % names.length] ?? 'job_done';
            return many.check(name, VALID[name]);
        });
        expect(all.filter((result) => result.ok)).toHaveLength(FIELD_EVENT_BUDGET.total);
    });
});
