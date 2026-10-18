/**
 * The Terra Draw modes the admin's map uses (docs/research/M2c-interfaces.md §4.4): `static` shows the shapes, the four
 * drawing modes add one, `select` drags a feature, a vertex or a midpoint (which inserts a vertex); a vertex is removed
 * from the vertex list, or with Terra Draw's own gesture where it offers one. Everything is drawn in the edited item's
 * colour: shapes as the viewer draws a POI category (a translucent fill, a solid outline), vertices and midpoints as
 * white-ringed dots large enough to grab. Style names follow Terra Draw 1.x (**UNVERIFIED** until installed, as
 * `terra-draw-types.ts` says).
 */
import { SELECT_MODE, STATIC_MODE } from './mode-names.js';
import type { TdModeOptions, TdStyles, TdValidation, TerraDrawModules } from './terra-draw-types.js';

const WHITE = '#ffffff';

/** A vertex handle's radius in CSS px: 10 px plus its 2 px ring is a 24 px target (WCAG 2.5.8 minimum). */
const HANDLE_RADIUS = 10;

const EDITABLE = { feature: { draggable: true, coordinates: { draggable: true, midpoints: true, deletable: true } } };

/** What `select` lets the admin move, per drawing mode. */
export const SELECT_FLAGS: Readonly<Record<string, unknown>> = {
    point: { feature: { draggable: true } },
    linestring: EDITABLE,
    polygon: EDITABLE,
    rectangle: { feature: { draggable: true, coordinates: { draggable: true, resizable: 'opposite' } } },
};

function handle(prefix: string, color: string): TdStyles {
    return {
        [`${prefix}Color`]: color,
        [`${prefix}Width`]: HANDLE_RADIUS,
        [`${prefix}OutlineColor`]: WHITE,
        [`${prefix}OutlineWidth`]: 2,
    };
}

/** The styles of each mode. */
interface DrawStyles {
    readonly static: TdStyles;
    readonly point: TdStyles;
    readonly linestring: TdStyles;
    readonly polygon: TdStyles;
    readonly rectangle: TdStyles;
    readonly select: TdStyles;
}

/** The styles of each mode, in `color`. */
function drawStyles(color: string): DrawStyles {
    const area = { fillColor: color, fillOpacity: 0.3, outlineColor: color, outlineWidth: 3 };
    return {
        static: {
            ...{ pointColor: color, pointWidth: HANDLE_RADIUS, lineStringColor: color, lineStringWidth: 4 },
            ...{ polygonFillColor: color, polygonFillOpacity: 0.3, polygonOutlineColor: color, polygonOutlineWidth: 3 },
        },
        point: handle('point', color),
        linestring: { lineStringColor: color, lineStringWidth: 4, ...handle('closingPoint', color) },
        polygon: { ...area, ...handle('closingPoint', color) },
        rectangle: area,
        select: { ...handle('selectionPoint', color), ...handle('midPoint', WHITE), ...handle('selectedPoint', color) },
    };
}

/** The mode instances for `new TerraDraw({modes})`; `validation` guards every drawing mode. */
export function drawModes(modules: TerraDrawModules, color: string, validation: TdValidation): readonly unknown[] {
    const styles = drawStyles(color);
    const drawing = (modeStyles: TdStyles): TdModeOptions => ({ styles: modeStyles, validation });
    return [
        new modules.TerraDrawRenderMode({ modeName: STATIC_MODE, styles: styles.static }),
        new modules.TerraDrawPointMode(drawing(styles.point)),
        new modules.TerraDrawLineStringMode(drawing(styles.linestring)),
        new modules.TerraDrawPolygonMode(drawing(styles.polygon)),
        new modules.TerraDrawRectangleMode(drawing(styles.rectangle)),
        new modules.TerraDrawSelectMode({ modeName: SELECT_MODE, flags: SELECT_FLAGS, styles: styles.select }),
    ];
}
