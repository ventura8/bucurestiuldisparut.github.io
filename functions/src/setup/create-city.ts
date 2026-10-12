import { FIRESTORE_PATHS, cityDocSchema, timestampFromDate, type CallableRequest, type CallableResponse, type CityDoc } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import type { Ports } from '../ports/index.js';
import { stampOf } from './records.js';

export type CreateCityDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'setup.createCity'>;

/** The new city: the client's fields, then the fields only the server writes (`id`, `createdAt`, published, the stamp). */
function newCity(request: Request, caller: VerifiedCaller, deps: CreateCityDeps): CityDoc {
    const stamp = stampOf(caller.uid, deps);
    return { ...request.city, id: request.cityId, published: true, createdAt: timestampFromDate(deps.clock.now()), ...stamp };
}

/**
 * `setup.createCity` (admin; docs/research/M2b-interfaces.md §3.3 d2, CR-M2b-1): right after the owner claim, the
 * Setup Assistant creates the city from the bundled seed (`legacy/<city>/city.json`), because the rules never let a
 * client create a city and `setup.saveMapbox` needs one. Idempotent: in one transaction, an existing city is left as it
 * is and answered `{created: false}`. The bundled city is public today (the static site), so it is created published:
 * its manifest appears once `setup.saveMapbox` writes the viewer token (the builder publishes nothing before).
 */
export async function createCity(
    deps: CreateCityDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'setup.createCity'>> {
    const path = FIRESTORE_PATHS.city(request.cityId);
    const created = await deps.documents.transaction(async (transaction) => {
        if ((await transaction.get(path, cityDocSchema)) !== undefined) {
            return false;
        }
        await transaction.create(path, cityDocSchema, newCity(request, caller, deps));
        return true;
    });
    deps.log.info('city created', { uid: caller.uid, cityId: request.cityId, created });
    return { created };
}
