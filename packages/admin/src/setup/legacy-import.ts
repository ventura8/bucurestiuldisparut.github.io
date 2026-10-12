/**
 * Step (h), the legacy Bucharest import (`docs/research/M2b-interfaces.md` §3.3 h): one click imports the 45 photos
 * through the normal photo pipeline (google-clients' importer, idempotent by document id and `legacyId`). The card
 * shows the progress, the photos that failed processing with their reason, and is done once every photo is imported.
 */
import type { SetupContext } from './context.js';
import { apiFailure, setupMessage } from './messages.js';
import type { LegacyImportProgress } from './ports.js';
import type { StepPatch } from './state.js';

export interface LegacyImportFlow {
    /** What is already imported (normal mode, no write). */
    detect(): Promise<void>;
    /** "Import the 45 photos": one click. */
    run(): Promise<void>;
}

function importHealth(progress: LegacyImportProgress, checkedAt: string): StepPatch {
    if (progress.failed.length > 0) {
        return { state: 'invalid', detail: setupMessage('adminSetup.import.failed', { count: String(progress.failed.length) }), checkedAt };
    }
    if (progress.total > 0 && progress.done >= progress.total) {
        return { state: 'ok', detail: null, checkedAt };
    }
    return { state: progress.done > 0 ? 'pending' : 'missing', detail: null, checkedAt };
}

class LegacyImport implements LegacyImportFlow {
    constructor(private readonly ctx: SetupContext) {}

    async detect(): Promise<void> {
        try {
            this.progress(await this.ctx.deps.importer.detect(), false);
        } catch (error) {
            this.ctx.fail('legacyImport', apiFailure(error));
        }
    }

    async run(): Promise<void> {
        this.ctx.count('legacyImport', 'inputs');
        this.ctx.patchStep('legacyImport', { busy: true, error: null });
        this.ctx.update((state) => ({ ...state, legacyImport: { ...state.legacyImport, running: true } }));
        try {
            const final = await this.ctx.deps.importer.run((progress) => {
                this.progress(progress, true);
            });
            this.progress(final, false);
        } catch (error) {
            this.ctx.update((state) => ({ ...state, legacyImport: { ...state.legacyImport, running: false } }));
            this.ctx.fail('legacyImport', apiFailure(error));
        }
    }

    private progress(progress: LegacyImportProgress, running: boolean): void {
        const { done, total, failed } = progress;
        this.ctx.update((state) => ({ ...state, legacyImport: { done, total, failed, running } }));
        this.ctx.patchStep('legacyImport', { ...importHealth(progress, this.ctx.nowIso()), busy: running });
    }
}

export function createLegacyImportFlow(ctx: SetupContext): LegacyImportFlow {
    return new LegacyImport(ctx);
}
