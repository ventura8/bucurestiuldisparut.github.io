/**
 * The city roles on the admins page (M5, `docs/research/M5-interfaces.md` §1.7; behaviour A51): what a row says of an
 * admin (their role in the city, the project's owner, you), the current city's name and the signed-in admin's role in
 * it, and the role field of an admin's detail and of the Invite dialog (a native `<select>`: one input to change it).
 */
import type { CityRole, Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { AdminCityPort, AdminStatePort } from '../admin-port.js';
import { shellText } from '../shell/text.js';

const CITY_ROLE_OPTIONS: readonly CityRole[] = ['editor', 'owner'];

/** A role as the page names it. */
export function roleText(locale: Locale, role: CityRole): string {
    return shellText(locale, role === 'owner' ? 'adminShell.city.role.owner' : 'adminShell.city.role.editor');
}

/** What an admin's row says besides their name: the role in the city, the project's owner, you. */
export function rowDetail(
    locale: Locale,
    admin: { readonly role: CityRole; readonly projectOwner: boolean; readonly self: boolean },
): string {
    const parts = [
        roleText(locale, admin.role),
        ...(admin.projectOwner ? [shellText(locale, 'adminShell.admins.projectOwner')] : []),
        ...(admin.self ? [shellText(locale, 'adminShell.admins.you')] : []),
    ];
    return parts.join(' · ');
}

/** The open city of the shell's state, if the session listed it. */
function currentCity(state: AdminStatePort | null): AdminCityPort | undefined {
    return state?.cities?.find((city) => city.id === state.cityId);
}

/** A city's name in `locale` (the Romanian one when it has no English name). */
function nameIn(city: AdminCityPort, locale: Locale): string {
    return locale === 'en' ? (city.name.en ?? city.name.ro) : city.name.ro;
}

/** The open city's name in `locale` (its id when unknown). */
export function currentCityName(state: AdminStatePort | null, locale: Locale): string {
    const city = currentCity(state);
    return city === undefined ? (state?.cityId ?? '') : nameIn(city, locale);
}

/** Whether the signed-in admin owns the open city (only owners invite, remove and change roles). */
export function ownsCurrentCity(state: AdminStatePort | null): boolean {
    return currentCity(state)?.role === 'owner';
}

export interface RoleFieldContext {
    readonly locale: Locale;
    readonly id: string;
    readonly label: string;
    readonly value: CityRole;
    readonly disabled: boolean;
    readonly change?: (role: CityRole) => void;
}

/** A role field: its label, and Editor and Owner. */
export function roleField(context: RoleFieldContext): TemplateResult {
    const changed = (event: Event): void => {
        const value = (event.currentTarget as HTMLSelectElement).value;
        context.change?.(value === 'owner' ? 'owner' : 'editor');
    };
    return html`<div class="field">
        <label for=${context.id}>${context.label}</label>
        <select id=${context.id} name="role" ?disabled=${context.disabled} @change=${changed}>
            ${CITY_ROLE_OPTIONS.map(
                (role) => html`<option value=${role} ?selected=${role === context.value}>${roleText(context.locale, role)}</option>`,
            )}
        </select>
    </div>`;
}
