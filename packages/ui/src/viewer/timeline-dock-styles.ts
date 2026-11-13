/**
 * Where the timeline's pill docks on a phone (V12, `timeline-dock.ts`): collapsed, the card is 48 px tall (a 40 px pill in
 * 4 px of card; 68 px wide standing), so the chip, the menu's gap and everything docked by `--hcm-timeline-block` follow it.
 * Standing, the pill keeps the foot of the column the card took, 8 px over the chip, and the map gets the column back; on a
 * short window it keeps the trailing end the chip is aligned to, under the chip, clear of the menu button, the zoom group
 * and the compass on the leading side and of Mapbox's legal line below. Comes after `dock-styles.ts`.
 */
import { css } from 'lit';

export const timelineDockStyles = css`
    .frame[data-timeline-collapsed] {
        --hcm-timeline-block: 48px;
    }

    .frame[data-timeline='vertical'][data-timeline-collapsed] .dock.timeline {
        inset-block-start: auto;
    }

    .frame[data-compact-height][data-timeline-collapsed] .dock.timeline {
        inset-inline: auto max(var(--hcm-gutter), 50% - 356px);
        max-inline-size: none;
        margin-inline: 0;
    }
`;
