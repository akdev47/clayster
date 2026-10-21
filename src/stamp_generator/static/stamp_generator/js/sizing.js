import { bounds, transform } from "./pipeline/canonical.js";

export const MILLIMETRES_PER_POINT = 25.4 / 72;
export const pointsToMillimetres = (points) => points * MILLIMETRES_PER_POINT;
export const millimetresToPoints = (millimetres) => millimetres / MILLIMETRES_PER_POINT;

/** The visible, axis-aligned extent of the actual transformed artwork. */
export function elementDimensionsCm(canonical, elementTransform) {
  if (!canonical?.length) return null;
  const box = bounds(elementTransform ? transform(canonical, elementTransform) : canonical);
  return { width: box.width / 10, height: box.height / 10 };
}

/** Points are presentation only: model callbacks and drag previews use mm. */
export function createTextSizeControls({ range, input, output, minMm, maxMm, onChange }) {
  for (const control of [range, input]) {
    control.min = String(millimetresToPoints(minMm));
    control.max = String(millimetresToPoints(maxMm));
    control.addEventListener("input", () => {
      if (control.value === "") return;
      const sizeMm = pointsToMillimetres(Number(control.value));
      if (Number.isFinite(sizeMm) && sizeMm >= minMm - 1e-9 && sizeMm <= maxMm + 1e-9) {
        onChange(Math.min(maxMm, Math.max(minMm, sizeMm)));
      }
    });
  }
  range.step = "any";
  input.step = "any";

  return {
    update(sizeMm) {
      const points = millimetresToPoints(sizeMm);
      // Display rounding must never feed back into saved fontSizeMm.
      range.value = String(points);
      if (input !== input.ownerDocument?.activeElement) {
        input.value = String(Math.round(points * 100) / 100);
      }
      output.textContent = `${Math.round(points * 100) / 100} pt`;
    },
  };
}
