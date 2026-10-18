/**
 * The editors' daily flows and how many in-app inputs each may take (`docs/research/M2c-interfaces.md` §5.6; behaviour
 * A30): clicks, fills, file choices and key presses that commit, as the Setup Assistant's `SETUP_STEP_SPECS` count them.
 * The e2e tier reads these (`@hcm/admin/content/budgets`, CR-M2c-11) and fails a flow that takes more
 * (`S-A30-HAPPY-CONTENT`). `perVertex` adds one input per vertex of a drawn shape, `perMove` one per slider moved.
 *
 * Shared by every workstream: one marked section per area (§11.2); a workstream adds its flows inside its own section.
 */
export interface ContentFlowBudget {
    /** The inputs of the happy path. */
    readonly inputs: number;
    /** What the flow is, as the contract's table says it. */
    readonly how: string;
    /** One more input per vertex (a polygon of n vertices), or per slider moved. */
    readonly per?: 'vertex' | 'move';
}

export const CONTENT_INPUT_BUDGETS = {
    // [section photos] owner: photos
    photoBatch: { inputs: 3, how: 'drop (or choose) the files, Select all, Publish' },
    photoWithoutExif: { inputs: 4, how: "the batch's 3, plus one drag of the pin (or Confirm place at the last pin)" },
    photoDirection: { inputs: 3, how: 'Set direction, a click on what the camera looked at, Save' },
    photoReplace: { inputs: 2, how: 'Replace image in the overflow menu, choose the file' },
    // [end photos]
    // [section pois] owner: pois
    pointPlace: { inputs: 5, how: 'Add place, Point, a click, the Romanian title, Save' },
    polygonPlace: { inputs: 4, how: 'Add place, Area, n clicks (the last on the first vertex), the title, Save', per: 'vertex' },
    geojsonImport: { inputs: 3, how: 'choose the file, one category for the uncategorised features, Import' },
    // [end pois]
    // [section layers] owner: layers-settings
    layerAdjustments: { inputs: 1, how: 'the sliders, Save', per: 'move' },
    // [end layers]
    // [section settings] owner: layers-settings
    category: { inputs: 3, how: 'Add category, the Romanian label (the icon follows it until one is picked), Save' },
    // [end settings]
    // [section ops] owner: ops-screens
    deleteAndUndo: { inputs: 3, how: 'Delete, confirm, Undo' },
    inviteAdmin: { inputs: 3, how: 'Invite, the address, Invite in the dialog (the link is copied at once)' },
    revokeAdmin: { inputs: 3, how: "the admin's row, Remove access, confirm" },
    revertChange: { inputs: 3, how: 'the version, Revert, confirm' },
    cancelJob: { inputs: 3, how: "the job's row, Cancel job, confirm" },
    // [end ops]
} as const satisfies Readonly<Record<string, ContentFlowBudget>>;

export type ContentFlow = keyof typeof CONTENT_INPUT_BUDGETS;

/** The budget of `flow` for a shape of `vertices` vertices or `moves` slider moves (zero for the others). */
export function contentFlowBudget(flow: ContentFlow, extra = 0): number {
    const budget: ContentFlowBudget = CONTENT_INPUT_BUDGETS[flow];
    return budget.inputs + (budget.per === undefined ? 0 : extra);
}
