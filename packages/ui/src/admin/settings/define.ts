/**
 * Registers the settings area's page and the icon picker it renders (`docs/research/M2c-interfaces.md` §8.5). The kit
 * elements (overlay list, slider, dialog, buttons) and the editing kit come with `defineAdminElements`. Idempotent.
 */
import { defineHcmIconPicker } from './hcm-icon-picker.js';
import { defineHcmSettingsPage } from './hcm-settings-page.js';

export function defineSettingsElements(registry: CustomElementRegistry = customElements): void {
    defineHcmIconPicker(registry);
    defineHcmSettingsPage(registry);
}
