/**
 * The entry of the side-loaded part `engine.lightbox.js` (`packages/engine/vite.part.config.ts`): running it registers
 * `<hcm-lightbox>`. Everything it needs besides the element, its zoom and its styles comes from the engine's kit
 * (`lightbox-kit.ts`).
 */
import { defineHcmLightbox } from './hcm-lightbox.js';

defineHcmLightbox();
