// Shared text-fitting settings, consumed by wrapText() in text.js.
/**
 * The limits a piece of text is held to, in millimetres. Nothing in the app
 * exposes these — they are set here and the text pipeline follows them.
 *
 * The limit is a width rather than a count of characters on purpose: how many
 * fit is a question about the font and the size, not about the stamp. A 60 mm
 * row takes three "W"s at 16 mm and seven at 8 mm, and an "i" is worth a
 * quarter of a "W" wherever it lands. Measuring glyphs answers that for every
 * font, including an uploaded one; a character count cannot.
 */
export const TEXT_LIMITS = {
    // The widest a single row of text may be.
    rowWidth: 60,

    // How many rows it may run to before the text counts as too long.
    rows: 4,

    // Lower bound for automatic shrinking, not a guarantee of printable detail.
    minSize: 6
};
