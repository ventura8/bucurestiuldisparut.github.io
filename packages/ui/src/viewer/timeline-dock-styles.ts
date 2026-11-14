/**
 * Where the timeline's pill docks on a phone (V12, `timeline-dock.ts`): collapsed, the card is 64 px tall (a 56 px pill in
 * 4 px of card, the year in title large; 96 px wide or more), so the chip, the menu's gap and everything docked by `--hcm-timeline-block` follow it.
 * Standing, the pill keeps the foot of the column the card took, 8 px over the chip, and the map gets the column back; on a
 * short window it keeps the trailing end the chip is aligned to, under the chip, clear of the menu button, the zoom group
 * and the compass on the leading side and of Mapbox's legal line below. Comes after `dock-styles.ts`.
 */
import { css } from 'lit';

export const timelineDockStyles = css`
    .frame[data-timeline-collapsed] {
        --hcm-timeline-block: 64px;
    }

    .frame[data-timeline='vertical'][data-timeline-collapsed] .dock.timeline {
        inset-block-start: auto;
    }

    /* Upright the 40 px chip stays centred under the 96 px pill (88 px of year in 4 px of card): 28 px in, not the card's 14. */
    .frame[data-timeline='vertical'][data-timeline-collapsed] .dock.chip {
        inset-inline-start: calc(var(--hcm-gutter) + 28px);
    }

    .frame[data-compact-height][data-timeline-collapsed] .dock.timeline {
        inset-inline: auto var(--hcm-gutter);
    }

    /*
     * Upright the larger pill (96 px or more) is wider than the 68 px column the open menu keeps clear, and at 320 x 568
     * the six items do not fit above its row: while the menu is open the pill steps aside, as a short window's whole dock
     * does (dock-styles.ts); the menu is the visitor's task then, and closing it brings the pill back.
     */
    .frame[data-timeline='vertical'][data-timeline-collapsed]:has(.dock.menu > [open]) .dock.timeline {
        visibility: hidden;
    }
`;
