/**
 * An editor area page's funnels (`AreaPage.funnels`, §200): each snapshot of a view compared with the page's last one
 * (`trackFunnel`). In the admin's `funnels` chunk with the wizards' snapshots, out of `editor-shared`.
 */
import { trackFunnel, type FunnelSnapshot } from '@hcm/shared/funnels';

export function trackAreaFunnels<State>(
    target: EventTarget,
    funnels: ((view: State) => readonly (FunnelSnapshot | null)[]) | undefined,
    view: State | null,
): void {
    if (funnels !== undefined && view !== null) {
        for (const snapshot of funnels(view)) {
            trackFunnel(target, snapshot);
        }
    }
}
