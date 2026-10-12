import { catalogueTranslator } from '../catalogue.js';
import { en } from './en.js';
import { ro, type AdminSetupKey } from './ro.js';

export type { AdminSetupKey, AdminSetupMessages } from './ro.js';

/** The Setup Assistant's texts (`docs/research/M2b-interfaces.md` §3): steps, states, billing, provisioning, import. */
export const translateAdminSetup = catalogueTranslator<AdminSetupKey>({ ro, en });
