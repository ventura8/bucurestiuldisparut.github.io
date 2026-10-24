/**
 * The imagery callables as the admin calls them (`docs/research/M3-interfaces.md` §9.1): the schemas of
 * `@hcm/shared`'s `api/imagery.ts`, called through the shell's guarded callables and their answers validated here. The
 * registry rows are fn-imagery's (CR-M3-3); until they land a name the registry does not know fails like any internal
 * error, so the admin says the server could not answer instead of breaking. A refusal becomes a notice: its
 * `apiError.*` code and parameters, which the pages translate.
 */
import {
    imageryApproveResponseSchema,
    imageryBrowseRequestSchema,
    imageryBrowseResponseSchema,
    imageryChooseRequestSchema,
    imageryChooseResponseSchema,
    imageryCropRequestSchema,
    imageryCropResponseSchema,
    imageryImportRequestSchema,
    imageryImportResponseSchema,
    imageryProbeRequestSchema,
    imageryProbeResponseSchema,
    imageryRejectResponseSchema,
    imageryResumeGuardRequestSchema,
    imageryResumeGuardResponseSchema,
    imageryRetryRequestSchema,
    imageryRetryResponseSchema,
    imagerySaveGcpsRequestSchema,
    imagerySaveGcpsResponseSchema,
    imagerySearchRequestSchema,
    imagerySearchResponseSchema,
    imageryStudioDoneResponseSchema,
    imageryVersionRequestSchema,
} from '@hcm/shared';
import type { z } from 'zod';

import { CallableFailure, type CallablesPort, type CallOptions } from '../firebase/ports.js';
import type { NoticeInput } from '../state/state.js';

/** Each imagery callable's request and response schemas. */
const IMAGERY_CALLS = {
    'imagery.search': { request: imagerySearchRequestSchema, response: imagerySearchResponseSchema },
    'imagery.browse': { request: imageryBrowseRequestSchema, response: imageryBrowseResponseSchema },
    'imagery.import': { request: imageryImportRequestSchema, response: imageryImportResponseSchema },
    'imagery.approve': { request: imageryVersionRequestSchema, response: imageryApproveResponseSchema },
    'imagery.reject': { request: imageryVersionRequestSchema, response: imageryRejectResponseSchema },
    'imagery.choose': { request: imageryChooseRequestSchema, response: imageryChooseResponseSchema },
    'imagery.studioDone': { request: imageryVersionRequestSchema, response: imageryStudioDoneResponseSchema },
    'imagery.saveGcps': { request: imagerySaveGcpsRequestSchema, response: imagerySaveGcpsResponseSchema },
    'imagery.crop': { request: imageryCropRequestSchema, response: imageryCropResponseSchema },
    'imagery.retry': { request: imageryRetryRequestSchema, response: imageryRetryResponseSchema },
    'imagery.probeTiles': { request: imageryProbeRequestSchema, response: imageryProbeResponseSchema },
    'imagery.resumeGuard': { request: imageryResumeGuardRequestSchema, response: imageryResumeGuardResponseSchema },
} as const;

export type ImageryCallName = keyof typeof IMAGERY_CALLS;
export type ImageryRequest<N extends ImageryCallName> = z.input<(typeof IMAGERY_CALLS)[N]['request']>;
export type ImageryResponse<N extends ImageryCallName> = z.output<(typeof IMAGERY_CALLS)[N]['response']>;

/** The shell's `call` without the registry's names (CR-M3-3 adds the imagery rows). */
type AnyCall = (name: string, request: unknown, options: CallOptions) => Promise<unknown>;

const INTERNAL = (): CallableFailure => new CallableFailure('internal', { code: 'apiError.internal' });

/** Calls `name`; rejects with a `CallableFailure` (an answer that fails its schema, or any other error, is internal). */
export async function callImagery<N extends ImageryCallName>(
    callables: CallablesPort,
    name: N,
    request: ImageryRequest<N>,
    options: CallOptions = {},
): Promise<ImageryResponse<N>> {
    const call = callables.call.bind(callables) as unknown as AnyCall;
    let answer: unknown;
    try {
        answer = await call(name, request, options);
    } catch (error) {
        throw error instanceof CallableFailure ? error : INTERNAL();
    }
    const parsed = IMAGERY_CALLS[name].response.safeParse(answer);
    if (!parsed.success) {
        throw INTERNAL();
    }
    return parsed.data as ImageryResponse<N>;
}

/** A failed call as a notice (a failure that is no callable's, such as the network, is `apiError.unavailable`). */
export function refusalOf(error: unknown): NoticeInput {
    if (!(error instanceof CallableFailure)) {
        return { key: 'apiError.unavailable' };
    }
    const { code, params } = error.details;
    return params === undefined ? { key: code } : { key: code, params };
}
