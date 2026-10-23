// Limits on the text a customer may enter, consumed by fitText() in text.js.
import { SETTINGS } from "../settings.js";

/**
 * Only the number of rows is limited. A row's width and size are not: text
 * that is too wide or too small for the stamp is reported by the shared
 * overflow and thin-feature warnings instead of being changed silently.
 * The value itself lives in settings.js (text.maxRows).
 */
export const TEXT_LIMITS = Object.freeze({
  rows: SETTINGS.text.maxRows,
});
