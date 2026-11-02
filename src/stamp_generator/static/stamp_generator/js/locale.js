// The language of the page and how numbers and money are written in it. Texts
// are written in Dutch where they are used; this is the one place that decides
// the locale, so a decimal comma (20,9 mm) and "€ 12,50" come out the same
// everywhere.

export const LOCALE = "nl-NL";

/** A number with as many decimals as it needs, up to `digits`: 0,8 / 2 / 20,94. */
export function formatNumber(value, digits = 2) {
  return new Intl.NumberFormat(LOCALE, {
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value);
}

/** A number with exactly `digits` decimals: 20,9 / 6,0. */
export function formatFixed(value, digits = 1) {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value);
}

/** Money for people, from cents: "€ 12,50". */
export function formatEuros(cents, currency = "EUR") {
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency }).format(
    cents / 100,
  );
}

/** What a design element is called on the page. */
export const ELEMENT_KIND_LABELS = Object.freeze({
  text: "tekst",
  svg: "SVG",
  png: "PNG",
});
